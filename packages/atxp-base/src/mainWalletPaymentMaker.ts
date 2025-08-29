import { PaymentMaker } from '@atxp/client';
import { encodeFunctionData } from 'viem';
import { USDC_CONTRACT_ADDRESS_BASE, type Hex } from '@atxp/client';
import BigNumber from 'bignumber.js';
import { ConsoleLogger, Logger, Currency } from '@atxp/common';

const USDC_DECIMALS = 6;

// Helper function to convert to base64url that works in both Node.js and browsers
function toBase64Url(data: string): string {
  // Convert string to base64
  const base64 = typeof Buffer !== 'undefined' 
    ? Buffer.from(data).toString('base64')
    : btoa(data);
  // Convert base64 to base64url
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export type MainWalletProvider = {
  request: (params: { 
    method: string; 
    params?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export class MainWalletPaymentMaker implements PaymentMaker {
  private logger: Logger;
  
  constructor(
    private walletAddress: string,
    private provider: MainWalletProvider,
    logger?: Logger
  ) {
    this.logger = logger || new ConsoleLogger();
  }

  async generateJWT(payload: {
    paymentRequestId: string;
    codeChallenge: string;
  }): Promise<string> {
    this.logger.info(`codeChallenge: ${payload.codeChallenge}`);
    this.logger.info(`paymentRequestId: ${payload.paymentRequestId}`);
    this.logger.info(`walletAddress: ${this.walletAddress}`);

    // Generate EIP-1271 auth data for main wallet authentication
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString(36).substring(2, 15);
    
    // Construct the message in the required format - must match BaseAppPaymentMaker exactly
    const messageParts = [
      `PayMCP Authorization Request`,
      ``,
      `Wallet: ${this.walletAddress}`,
      `Timestamp: ${timestamp}`,
      `Nonce: ${nonce}`
    ];
    
    if (payload.codeChallenge) {
      messageParts.push(`Code Challenge: ${payload.codeChallenge}`);
    }
    
    if (payload.paymentRequestId) {
      messageParts.push(`Payment Request ID: ${payload.paymentRequestId}`);
    }
    
    messageParts.push('', '', 'Sign this message to prove you control this wallet.');
    const message = messageParts.join('\n');

    // Sign with the main wallet
    const signature = await this.provider.request({
      method: 'personal_sign',
      params: [message, this.walletAddress]
    });

    // Create EIP-1271 auth data
    const authData = {
      type: 'EIP1271_AUTH',
      walletAddress: this.walletAddress,
      message: message,
      signature: signature,
      timestamp: timestamp,
      nonce: nonce,
      ...(payload.codeChallenge && { code_challenge: payload.codeChallenge }),
      ...(payload.paymentRequestId && { payment_request_id: payload.paymentRequestId })
    };

    // Encode as base64url
    const encodedAuth = toBase64Url(JSON.stringify(authData));
    this.logger.info(`Generated EIP-1271 auth data: ${encodedAuth}`);
    
    return encodedAuth;
  }

  async makePayment(
    amount: BigNumber,
    currency: Currency,
    receiver: string,
    _reason: string
  ): Promise<string> {
    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported');
    }

    this.logger.info(`Making direct payment of ${amount} ${currency} to ${receiver} on Base`);

    // Convert amount to USDC units (6 decimals)
    const amountInUSDCUnits = BigInt(amount.multipliedBy(10 ** USDC_DECIMALS).toFixed(0));

    // Encode the transfer function data
    const transferData = encodeFunctionData({
      abi: [{
        name: 'transfer',
        type: 'function',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' }
        ],
        outputs: [{ name: '', type: 'bool' }]
      }],
      functionName: 'transfer',
      args: [receiver as Hex, amountInUSDCUnits]
    });

    // Send the transaction through the user's wallet
    const txHash = await this.provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: this.walletAddress,
        to: USDC_CONTRACT_ADDRESS_BASE,
        data: transferData,
        value: '0x0'
      }]
    });

    this.logger.info(`Transaction submitted. TxHash: ${txHash}`);
    
    // Wait for confirmations
    const CONFIRMATIONS = 2;
    await this.waitForTransactionConfirmations(txHash, CONFIRMATIONS);
    
    return txHash;
  }

  private async waitForTransactionConfirmations(txHash: string, confirmations: number): Promise<void> {
    this.logger.info(`Waiting for ${confirmations} confirmations...`);
    
    // Poll for transaction receipt
    let receipt = null;
    while (!receipt) {
      try {
        receipt = await this.provider.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash]
        });
        
        if (!receipt) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        this.logger.warn(`Error getting receipt: ${error}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Check if transaction was successful
    if (receipt.status === '0x0') {
      throw new Error(`Transaction failed. TxHash: ${txHash}`);
    }

    // Wait for confirmations
    const startBlock = parseInt(receipt.blockNumber, 16);
    let currentBlock = startBlock;

    while (currentBlock - startBlock < confirmations - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const blockNumber = await this.provider.request({
        method: 'eth_blockNumber',
        params: []
      });
      
      currentBlock = parseInt(blockNumber, 16);
    }

    this.logger.info(`Transaction confirmed with ${confirmations} confirmations`);
  }
}
