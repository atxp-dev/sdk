import { BasePaymentMaker } from '@atxp/client';
import { Logger, Currency } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { parseEther, WalletClient, createWalletClient, http, publicActions, PublicClient, encodeFunctionData, getAddress} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { SpendPermission } from './types.js';

export class BaseAppPaymentMaker extends BasePaymentMaker {
  private spendPermission: SpendPermission;
  private walletClient: WalletClient;
  private ephemeralAccount: ReturnType<typeof privateKeyToAccount>;

  constructor(baseRPCUrl: string, spendPermission: SpendPermission, privateKey: `0x${string}`, logger?: Logger) {
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    super(baseRPCUrl, privateKey, logger);
    this.spendPermission = spendPermission;
    this.ephemeralAccount = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({
      account: this.ephemeralAccount,
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

    // Convert USDC amount to its smallest unit (6 decimals)
    // 0.01 USDC = 10,000 micro-USDC
    const USDC_DECIMALS = 6;
    const amountInMicroUsdc = amount.multipliedBy(10 ** USDC_DECIMALS);
    const amountBigInt = BigInt(amountInMicroUsdc.toFixed(0));
    
    // SpendPermissionManager contract on Base mainnet
    const SPEND_PERMISSION_MANAGER = getAddress('0x4b22970FBf7Bb7F3FBe4fD8D68b53e5d497c6E4D');
    
    // USDC contract on Base mainnet
    const USDC_CONTRACT = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    
    // Encode the spend permission call
    const spendPermissionCalldata = encodeFunctionData({
      abi: [{
        inputs: [
          { name: 'spendPermission', type: 'tuple', components: [
            { name: 'account', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'allowance', type: 'uint160' },
            { name: 'period', type: 'uint48' },
            { name: 'start', type: 'uint48' },
            { name: 'end', type: 'uint48' },
            { name: 'salt', type: 'uint256' },
            { name: 'extraData', type: 'bytes' }
          ]},
          { name: 'signature', type: 'bytes' },
          { name: 'amount', type: 'uint160' }
        ],
        name: 'spend',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function'
      }],
      functionName: 'spend',
      args: [
        {
          account: this.spendPermission.permission.account as `0x${string}`,
          spender: this.spendPermission.permission.spender as `0x${string}`,
          token: this.spendPermission.permission.token as `0x${string}`,
          allowance: BigInt(this.spendPermission.permission.allowance),
          period: Number(this.spendPermission.permission.period),
          start: Number(this.spendPermission.permission.start),
          end: Number(this.spendPermission.permission.end),
          salt: BigInt(this.spendPermission.permission.salt),
          extraData: this.spendPermission.permission.extraData as `0x${string}`
        },
        this.spendPermission.signature as `0x${string}`,
        amountBigInt
      ]
    });
    
    // Execute the spend permission transaction
    // The transaction is sent from the ephemeral wallet (created from privateKey)
    // which is the spender in the spend permission
    const hash = await this.walletClient.sendTransaction({
      account: this.ephemeralAccount,
      chain: base,
      to: SPEND_PERMISSION_MANAGER,
      data: spendPermissionCalldata,
      value: parseEther('0'),
    });
    
    this.logger.info(`Spend permission transaction sent: ${hash}`);
    
    // Wait for transaction confirmation
    const receipt = await (this.walletClient as unknown as PublicClient).waitForTransactionReceipt({ 
      hash: hash as `0x${string}`,
      confirmations: 3  // Wait for 3 confirmations to ensure better propagation
    });
    
    if (receipt.status === 'reverted') {
      throw new Error(`Spend permission transaction reverted: ${hash}`);
    }
    
    this.logger.info(`Spend permission transaction confirmed: ${hash} in block ${receipt.blockNumber}`);
    
    // Now the ephemeral wallet has the funds, make the actual payment
    return await super.makePayment(amount, currency, receiver);
  }
}
