import { BasePaymentMaker } from '@atxp/client';
import { Logger, Currency } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { encodeFunctionData, getAddress, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { SpendPermission } from './types.js';
import { createEphemeralSmartWallet, type SmartWalletConfig, type EphemeralSmartWallet } from './smartWalletHelpers.js';

export class BaseAppPaymentMaker extends BasePaymentMaker {
  private spendPermission: SpendPermission;
  private smartWallet?: EphemeralSmartWallet;
  private smartWalletConfig: SmartWalletConfig;
  private privateKey: `0x${string}`;
  private baseRPCUrl: string;

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
    this.baseRPCUrl = baseRPCUrl;
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
    const SPEND_PERMISSION_MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
    
    // USDC contract on Base mainnet
    const USDC_CONTRACT = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    
    // Debug: Log spend permission details
    const now = Math.floor(Date.now() / 1000);
    console.log('Spend permission details:', {
      account: this.spendPermission.permission.account,
      spender: this.spendPermission.permission.spender,
      token: this.spendPermission.permission.token,
      allowance: this.spendPermission.permission.allowance,
      amount: amountBigInt.toString(),
      receiver,
      smartWallet: this.smartWallet?.address,
      currentTime: now,
      start: this.spendPermission.permission.start,
      end: this.spendPermission.permission.end,
      isValid: now >= Number(this.spendPermission.permission.start) && now <= Number(this.spendPermission.permission.end),
      salt: this.spendPermission.permission.salt,
      extraData: this.spendPermission.permission.extraData,
      signature: this.spendPermission.signature
    });
    
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

    // The smart wallet should already be deployed during BaseAppAccount initialization
    // If it's not deployed, log a warning but proceed - the paymaster might handle it
    const publicClient = createPublicClient({
      chain: base,
      transport: http(this.baseRPCUrl)
    });
    
    const smartWalletCode = await publicClient.getCode({ 
      address: this.smartWallet.address 
    });
    
    const isDeployed = smartWalletCode !== '0x' && smartWalletCode !== undefined;
    
    if (!isDeployed) {
      this.logger.warn(`Smart wallet not deployed at ${this.smartWallet.address}. It should have been deployed during initialization.`);
      this.logger.warn(`The transaction may still succeed if the paymaster handles deployment.`);
    } else {
      this.logger.info(`Smart wallet is deployed at ${this.smartWallet.address}`);
    }

        // For smart wallets, we need to execute the spend permission
    // The SpendPermissionManager will transfer USDC from user to smart wallet
    // Then we need to forward it to the final receiver
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

    // Send UserOperation with both calls in sequence
    try {
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
        ],
        paymaster: true
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
    } catch (error) {
      console.error('UserOperation failed:', error);
      
      // Add detailed debugging for spend permission errors
      if (error instanceof Error && error.message.includes('Execution reverted')) {
        console.error('=== SPEND PERMISSION DEBUGGING ===');
        console.error('Spend permission details:');
        console.error('- Account:', this.spendPermission.permission.account);
        console.error('- Spender:', this.spendPermission.permission.spender);
        console.error('- Token:', this.spendPermission.permission.token);
        console.error('- Allowance:', this.spendPermission.permission.allowance);
        console.error('- Amount:', amountBigInt.toString());
        console.error('- Receiver:', receiver);
        console.error('- Smart Wallet:', this.smartWallet?.address);
        console.error('- Current Time:', Math.floor(Date.now() / 1000));
        console.error('- Start:', Number(this.spendPermission.permission.start));
        console.error('- End:', Number(this.spendPermission.permission.end));
        console.error('- Is Valid:', Number(this.spendPermission.permission.start) <= Math.floor(Date.now() / 1000) && Math.floor(Date.now() / 1000) <= Number(this.spendPermission.permission.end));
        console.error('- Salt:', this.spendPermission.permission.salt);
        console.error('- Extra Data:', this.spendPermission.permission.extraData);
        console.error('- Signature Length:', this.spendPermission.signature.length);
        console.error('- Signature Preview:', this.spendPermission.signature.substring(0, 100) + '...');
        console.error('=== END DEBUGGING ===');
      }
      
      // Try to decode the specific error
      if (error instanceof Error && error.message.includes('execution reverted')) {
        console.error('The transaction reverted. Possible reasons:');
        console.error('1. The SpendPermissionManager rejected the spend permission');
        console.error('2. The permission signature might be invalid');
        console.error('3. The permission might have already been used (check salt)');
        console.error('4. The smart wallet might not be the correct spender');
        
        // Log the permission details again for debugging
        console.error('Permission was:', {
          account: this.spendPermission.permission.account,
          spender: this.spendPermission.permission.spender,
          smartWallet: this.smartWallet?.address
        });
      }
      
      throw error;
    }
  }
}
