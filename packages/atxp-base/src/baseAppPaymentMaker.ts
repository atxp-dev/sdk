import { BasePaymentMaker } from '@atxp/client';
import { Logger } from '@atxp/common';
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
  makePayment = async (amount: BigNumber, currency: string, receiver: string): Promise<string> => {
    currency = currency.toLowerCase();
    if (currency !== 'usdc') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    this._getLogger().info(`Making spendPermission payment of ${amount} ${currency} to ephemeral wallet on Base`);

    const spendCalls = await prepareSpendCallData(this.spendPermission, BigInt(amount.toString()));

    let hash: `0x${string}` | undefined;
    spendCalls.forEach(async (call) =>
      hash = await this.walletClient.sendTransaction({
        chain: base,
        to: call.to,
        data: call.data,
        value: parseEther('0'),
        account: this.spendPermission.permission.account as `0x${string}`,
      })
    );

    if (!hash) {
      throw new Error('No hash returned from spendPermission sendTransaction');
    }
    
    // Wait for transaction confirmation with more blocks to ensure propagation
    this._getLogger().info(`Waiting for spendPermission transaction confirmation: ${hash}`);
    const receipt = await (this.walletClient as unknown as PublicClient).waitForTransactionReceipt({ 
      hash: hash as `0x${string}`,
      confirmations: 3  // Wait for 3 confirmations to ensure better propagation
    });
    
    if (receipt.status === 'reverted') {
      throw new Error(`spendPermission transaction reverted: ${hash}`);
    }
    
    this._getLogger().info(`spendPermission transaction confirmed: ${hash} in block ${receipt.blockNumber}`);

    // ok, now the ephemeral wallet has control of the funds, and we need to make the normal payment from here
    return await super.makePayment(amount, currency, receiver);
  }
}
