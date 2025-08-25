import { BasePaymentMaker, USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import { Logger, Currency } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { encodeFunctionData, /*getAddress, Account,*/ WalletClient } from 'viem';
//import { SpendPermission } from './types.js';
import { type PaymasterSmartWallet } from './paymasterHelpers.js';

export class BaseAppPaymentMaker extends BasePaymentMaker {
  private smartWallet?: PaymasterSmartWallet;

  constructor(
    baseRPCUrl: string, 
    //spendPermission: SpendPermission, 
    //account: Account,
    walletClient: WalletClient,
    smartWallet?: PaymasterSmartWallet,
    logger?: Logger
  ) {
    //if (!spendPermission) {
      //throw new Error('Spend permission is required');
    //}
    super(baseRPCUrl, walletClient, logger);
    //this.spendPermission = spendPermission;
    this.smartWallet = smartWallet;
    this.isWebAuthn = true; // BaseAppPaymentMaker uses WebAuthn/Smart Wallet auth
  }

  // Override makePayment to use paymaster smart wallet when available
  async makePayment(amount: BigNumber, currency: Currency, receiver: string): Promise<string> {
    // If no smart wallet, use regular payment from parent class
    if (!this.smartWallet) {
      return super.makePayment(amount, currency, receiver);
    }

    // Use paymaster-sponsored transaction
    if (currency !== 'USDC') {
      throw new Error('Only USDC currency is supported; received ' + currency);
    }

    const amountBigInt = this.convertAmountToBigInt(amount);
    
    this.logger.info(`Making paymaster-sponsored payment of ${amount} ${currency} to ${receiver} on Base`);
    
    return await this.executePaymasterTransaction(amountBigInt, receiver);
  }

  private convertAmountToBigInt(amount: BigNumber): bigint {
    // Convert USDC amount to its smallest unit (6 decimals)
    const USDC_DECIMALS = 6;
    const amountInMicroUsdc = amount.multipliedBy(10 ** USDC_DECIMALS);
    return BigInt(amountInMicroUsdc.toFixed(0));
  }

  private async executePaymasterTransaction(amountBigInt: bigint, receiver: string): Promise<string> {
    
    // Prepare USDC transfer call
    const transferCalldata = encodeFunctionData({
      abi: [{
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' }
        ],
        name: 'transfer',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
        type: 'function'
      }],
      functionName: 'transfer',
      args: [receiver as `0x${string}`, amountBigInt]
    });

    try {
      // Send user operation with paymaster sponsorship
      const userOpHash = await this.smartWallet!.bundlerClient.sendUserOperation({
        calls: [{
          to: USDC_CONTRACT_ADDRESS_BASE,
          data: transferCalldata,
          value: 0n
        }],
      });

      this.logger.info(`Paymaster-sponsored UserOperation sent: ${userOpHash}`);

      // Wait for the operation to be confirmed
      const receipt = await this.smartWallet!.bundlerClient.waitForUserOperationReceipt({
        hash: userOpHash
      });

      if (!receipt.success) {
        throw new Error(`UserOperation failed: ${userOpHash}`);
      }

      this.logger.info(`Paymaster-sponsored payment confirmed: ${receipt.receipt.transactionHash}`);
      return receipt.receipt.transactionHash;
    } catch (error) {
      this.logger.error(`Paymaster transaction failed: ${error}`);
      throw error;
    }
  }


  // override makePayment to use spend permissions
  /*async makePayment(amount: BigNumber, currency: Currency, receiver: string): Promise<string> {
    this.validatePaymentRequest(currency);
    
    const amountBigInt = this.convertAmountToBigInt(amount);
    
    this.logger.info(`Making spendPermission payment of ${amount} ${currency} to ephemeral wallet on Base`);
    
    this.logPaymentDetails(amountBigInt, receiver);
    
    // Execute the payment transaction
    return await this.executePaymentTransaction(amountBigInt, receiver);
  }

  private validatePaymentRequest(currency: Currency): void {
    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }
  }

  private convertAmountToBigInt(amount: BigNumber): bigint {
    // Convert USDC amount to its smallest unit (6 decimals)
    // 0.01 USDC = 10,000 micro-USDC
    const USDC_DECIMALS = 6;
    const amountInMicroUsdc = amount.multipliedBy(10 ** USDC_DECIMALS);
    return BigInt(amountInMicroUsdc.toFixed(0));
  }

  private logPaymentDetails(amountBigInt: bigint, receiver: string): void {
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
  }

  private async executePaymentTransaction(amountBigInt: bigint, receiver: string): Promise<string> {
    const spendPermissionCalldata = this.prepareSpendPermissionCall(amountBigInt);
    const usdcTransferCalldata = this.prepareUSDCTransferCall(amountBigInt, receiver);

    try {
      const userOpHash = await this.sendUserOperation(spendPermissionCalldata, usdcTransferCalldata);
      return await this.waitForUserOperation(userOpHash);
    } catch (error) {
      this.handleTransactionError(error, amountBigInt, receiver);
      throw error;
    }
  }

  private prepareSpendPermissionCall(amountBigInt: bigint): `0x${string}` {
    const SPEND_PERMISSION_MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
    
    return encodeFunctionData({
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
  }

  private prepareUSDCTransferCall(amountBigInt: bigint, receiver: string): `0x${string}` {
    const USDC_CONTRACT = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    
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

    return encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [receiver as `0x${string}`, amountBigInt]
    });
  }

  private async sendUserOperation(
    spendPermissionCalldata: `0x${string}`,
    usdcTransferCalldata: `0x${string}`
  ): Promise<`0x${string}`> {
    const SPEND_PERMISSION_MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
    const USDC_CONTRACT = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

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
    return userOpHash;
  }

  private async waitForUserOperation(userOpHash: `0x${string}`): Promise<string> {
    const receipt = await this.smartWallet.client.waitForUserOperationReceipt({
      hash: userOpHash
    });

    if (!receipt.success) {
      throw new Error(`UserOperation failed: ${userOpHash}`);
    }

    this.logger.info(`UserOperation confirmed: ${userOpHash}`);
    return receipt.receipt.transactionHash;
  }

  private handleTransactionError(error: unknown, amountBigInt: bigint, receiver: string): void {
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
      console.error('- Smart Wallet:', this.smartWallet.address);
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
        smartWallet: this.smartWallet.address
      });
    }
  }*/
}
