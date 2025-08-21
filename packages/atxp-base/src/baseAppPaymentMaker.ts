import { BasePaymentMaker } from '@atxp/client';
import { Logger, Currency } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { encodeFunctionData, getAddress} from 'viem';
import { SpendPermission } from './types.js';
import { createEphemeralSmartWallet, type SmartWalletConfig, type EphemeralSmartWallet } from './smartWalletHelpers.js';

export class BaseAppPaymentMaker extends BasePaymentMaker {
  private spendPermission: SpendPermission;
  private smartWallet?: EphemeralSmartWallet;
  private smartWalletConfig: SmartWalletConfig;
  private privateKey: `0x${string}`;

  constructor(baseRPCUrl: string, spendPermission: SpendPermission, privateKey: `0x${string}`, smartWalletConfig: SmartWalletConfig, logger?: Logger) {
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    if (!smartWalletConfig) {
      throw new Error('Smart wallet configuration is required');
    }
    super(baseRPCUrl, privateKey, logger);
    this.spendPermission = spendPermission;
    this.smartWalletConfig = smartWalletConfig;
    this.privateKey = privateKey;
  }

  // Initialize smart wallet if needed
  private async ensureSmartWallet(): Promise<void> {
    if (!this.smartWallet) {
      this.smartWallet = await createEphemeralSmartWallet(
        this.privateKey,
        this.smartWalletConfig
      );
    }
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
    
    // Ensure smart wallet is initialized
    await this.ensureSmartWallet();
    if (!this.smartWallet) {
      throw new Error('Failed to initialize smart wallet');
    }

    // For smart wallets, batch the spend permission execution and USDC transfer
    // in a single UserOperation to save gas
    const USDC_ABI = [{
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      name: 'transfer',
      outputs: [{ name: '', type: 'bool' }],
      stateMutability: 'nonpayable',
      type: 'function'
    }];

    const usdcTransferCalldata = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [receiver as `0x${string}`, amountBigInt]
    });

    // Send UserOperation with both calls
    const userOpHash = await this.smartWallet.client.sendUserOperation({
      calls: [
        {
          to: SPEND_PERMISSION_MANAGER,
          data: spendPermissionCalldata,
          value: 0n
        },
        {
          to: USDC_CONTRACT,
          data: usdcTransferCalldata,
          value: 0n
        }
      ]
    });

    this.logger.info(`Smart wallet UserOperation sent: ${userOpHash}`);

    // Wait for the UserOperation to be included
    const receipt = await this.smartWallet.client.waitForUserOperationReceipt({
      hash: userOpHash
    });

    if (!receipt.success) {
      throw new Error(`UserOperation failed: ${userOpHash}`);
    }

    this.logger.info(`UserOperation confirmed: ${userOpHash}`);
    return receipt.receipt.transactionHash;
  }
}
