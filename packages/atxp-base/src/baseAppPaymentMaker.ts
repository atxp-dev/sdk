import { BasePaymentMaker } from '@atxp/client';
import { Logger, Currency } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { prepareSpendCallData } from "@base-org/account/spend-permission";
import { parseEther, WalletClient, createWalletClient, http, publicActions, PublicClient} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { SpendPermission } from './types.js';

export class BaseAppPaymentMaker extends BasePaymentMaker {
  private spendPermission: SpendPermission;
  private walletClient: WalletClient;

  constructor(baseRPCUrl: string, spendPermission: SpendPermission, privateKey: `0x${string}`, logger?: Logger) {
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    super(baseRPCUrl, privateKey, logger);
    this.spendPermission = spendPermission;
    this.walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey),
      chain: base,
      transport: http(baseRPCUrl),
    }).extend(publicActions);
  }

  // override makePayment to use spend permissions
  async makePayment(amount: BigNumber, currency: Currency, receiver: string): Promise<string> {
    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    this.logger.info(`Making spendPermission payment of ${amount} ${currency} to ephemeral wallet on Base`);

    const spendCalls = await prepareSpendCallData(this.spendPermission, BigInt(amount.toString()));

    const transactionHashes: `0x${string}`[] = [];
    // Execute spend calls sequentially to ensure proper order
    // Note: prepareSpendCallData may return multiple calls (e.g., permission approval + actual spend)
    // TODO: Investigate if these can be parallelized or if order matters
    for (const call of spendCalls) {
      const hash = await this.walletClient.sendTransaction({
        chain: base,
        to: call.to,
        data: call.data,
        value: parseEther('0'),
        account: this.spendPermission.permission.account as `0x${string}`,
      });
      transactionHashes.push(hash);
      this.logger.debug(`Spend permission transaction sent: ${hash}`);
    }

    if (transactionHashes.length === 0) {
      throw new Error('No transaction hashes returned from spendPermission sendTransaction');
    }
    
    // Use the last hash for waiting and logging (typically the actual spend transaction)
    const hash = transactionHashes[transactionHashes.length - 1];
    
    // Wait for transaction confirmation with more blocks to ensure propagation
    this.logger.info(`Waiting for spendPermission transaction confirmation: ${hash}`);
    const receipt = await (this.walletClient as unknown as PublicClient).waitForTransactionReceipt({ 
      hash: hash as `0x${string}`,
      confirmations: 3  // Wait for 3 confirmations to ensure better propagation
    });
    
    if (receipt.status === 'reverted') {
      throw new Error(`spendPermission transaction reverted: ${hash} (all hashes: ${transactionHashes.join(', ')})`);
    }
    
    this.logger.info(`spendPermission transaction confirmed: ${hash} in block ${receipt.blockNumber}`);
    if (transactionHashes.length > 1) {
      this.logger.debug(`All transaction hashes from spend permission: ${transactionHashes.join(', ')}`);
    }

    // ok, now the ephemeral wallet has control of the funds, and we need to make the normal payment from here
    return await super.makePayment(amount, currency, receiver);
  }
}
