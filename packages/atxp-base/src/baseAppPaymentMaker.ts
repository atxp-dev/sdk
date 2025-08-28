import { USDC_CONTRACT_ADDRESS_BASE, type PaymentMaker } from '@atxp/client';
import { Logger, Currency, ConsoleLogger } from '@atxp/common';
import { Address, encodeFunctionData, Hex, parseEther } from 'viem';
import { SpendPermission } from './types.js';
import { type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { prepareSpendCallData } from '@base-org/account/spend-permission';

// Helper function to convert to base64url that works in both Node.js and browsers
function toBase64Url(data: string): string {
  // Convert string to base64
  const base64 = typeof Buffer !== 'undefined' 
    ? Buffer.from(data).toString('base64')
    : btoa(data);
  // Convert base64 to base64url
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const USDC_DECIMALS = 6;

// Minimal ERC20 ABI for transfer function
const ERC20_ABI = [
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;

async function waitForTransactionConfirmations(
  smartWallet: EphemeralSmartWallet,
  txHash: string,
  confirmations: number,
  logger: Logger
): Promise<void> {
  try {
    const publicClient = smartWallet.client.account?.client;
    if (publicClient && 'waitForTransactionReceipt' in publicClient) {
      logger.info(`Waiting for ${confirmations} confirmations...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (publicClient as any).waitForTransactionReceipt({
        hash: txHash,
        confirmations: confirmations
      });
      logger.info(`Transaction confirmed with ${confirmations} confirmations`);
    } else {
      logger.warn('Unable to wait for confirmations: client does not support waitForTransactionReceipt');
    }
  } catch (error) {
    logger.warn(`Could not wait for additional confirmations: ${error}`);
    // Continue anyway - the transaction is already mined
  }
}

export class BaseAppPaymentMaker implements PaymentMaker {
  private logger: Logger;
  private spendPermission: SpendPermission;
  private smartWallet: EphemeralSmartWallet;

  constructor(
    spendPermission: SpendPermission,
    smartWallet: EphemeralSmartWallet,
    logger?: Logger
  ) {
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    if (!smartWallet) {
      throw new Error('Smart wallet is required');
    }
    this.logger = logger ?? new ConsoleLogger();
    this.spendPermission = spendPermission;
    this.smartWallet = smartWallet;
  }

  async generateJWT({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> {
    // Generate EIP-1271 auth data for smart wallet authentication
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString(36).substring(2, 15); // Generate random nonce
    
    // Construct the message in the required format
    const messageParts = [
      `PayMCP Authorization Request`,
      ``,
      `Wallet: ${this.smartWallet.account.address}`,
      `Timestamp: ${timestamp}`,
      `Nonce: ${nonce}`
    ];
    
    if (codeChallenge) {
      messageParts.push(`Code Challenge: ${codeChallenge}`);
    }
    
    if (paymentRequestId) {
      messageParts.push(`Payment Request ID: ${paymentRequestId}`);
    }
    
    messageParts.push('', '', 'Sign this message to prove you control this wallet.');
    const message = messageParts.join('\n');
    
    // Sign the message - this will return an ABI-encoded signature from the smart wallet
    const signature = await this.smartWallet.account.signMessage({
      message: message
    });
    
    // Create EIP-1271 auth data
    const authData = {
      type: 'EIP1271_AUTH',
      walletAddress: this.smartWallet.account.address,
      message: message,
      signature: signature,
      timestamp: timestamp,
      nonce: nonce,
      ...(codeChallenge && { code_challenge: codeChallenge }),
      ...(paymentRequestId && { payment_request_id: paymentRequestId })
    };
    
    // Encode as base64url
    const encodedAuth = toBase64Url(JSON.stringify(authData));
    
    this.logger.info(`codeChallenge: ${codeChallenge}`);
    this.logger.info(`paymentRequestId: ${paymentRequestId}`);
    this.logger.info(`walletAddress: ${this.smartWallet.account.address}`);
    this.logger.info(`Generated EIP-1271 auth data: ${encodedAuth}`);
    
    return encodedAuth;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async makePayment(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<string> {
    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    this.logger.info(`Making spendPermission payment of ${amount} ${currency} to ${receiver} on Base`);

    // Convert amount to USDC units (6 decimals) as BigInt for spendPermission
    const amountInUSDCUnits = BigInt(amount.multipliedBy(10 ** USDC_DECIMALS).toFixed(0));
    const spendCalls = await prepareSpendCallData(this.spendPermission, amountInUSDCUnits);
    
    // Add a second call to transfer USDC from the smart wallet to the receiver
    const transferCall = {
      to: USDC_CONTRACT_ADDRESS_BASE as Hex,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [receiver as Address, amountInUSDCUnits],
      }),
      value: '0x0' as Hex
    };
    
    // Combine spend permission calls with the transfer call
    const allCalls = [...spendCalls, transferCall];
    
    this.logger.info(`Executing ${allCalls.length} calls (${spendCalls.length} spend permission + 1 transfer)`);
    const hash = await this.smartWallet.client.sendUserOperation({ 
      account: this.smartWallet.account, 
      calls: allCalls.map(call => {
        return {
          to: call.to as Hex,
          data: call.data as Hex,
          value: BigInt(call.value || '0x0')
        }
      }),
      maxPriorityFeePerGas: parseEther('0.000000001')
    }) 
     
    const receipt = await this.smartWallet.client.waitForUserOperationReceipt({ hash })
    if (!receipt) {
      throw new Error('User operation failed');
    }
    
    // The receipt contains the actual transaction hash that was mined on chain
    const txHash = receipt.receipt.transactionHash;
    
    if (!txHash) {
      throw new Error('User operation was executed but no transaction hash was returned. This should not happen.');
    }
    
    this.logger.info(`Spend permission executed successfully. UserOp: ${receipt.userOpHash}, TxHash: ${txHash}`);
    
    // Wait for additional confirmations to ensure the transaction is well-propagated
    // This helps avoid the "Transaction receipt could not be found" error
    await waitForTransactionConfirmations(this.smartWallet, txHash, 2, this.logger);
    
    // Return the actual transaction hash, not the user operation hash
    // The payment verification system needs the on-chain transaction hash
    return txHash;
  }
}
