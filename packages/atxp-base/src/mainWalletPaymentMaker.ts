import { PaymentMaker } from '@atxp/client';
import { encodeFunctionData } from 'viem';
import { USDC_CONTRACT_ADDRESS_BASE, type Hex } from '@atxp/client';
import BigNumber from 'bignumber.js';
import { ConsoleLogger, Logger, Currency } from '@atxp/common';

const USDC_DECIMALS = 6;

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

    // Generate auth message
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString(36).substring(2, 15);
    
    let message = `PayMCP Authorization Request\n\n`;
    message += `Wallet: ${this.walletAddress}\n`;
    message += `Timestamp: ${timestamp}\n`;
    message += `Nonce: ${nonce}`;
    
    if (payload.paymentRequestId) {
      message += `\nPayment Request ID: ${payload.paymentRequestId}`;
    }
    
    if (payload.codeChallenge) {
      message += `\nCode Challenge: ${payload.codeChallenge}`;
    }
    
    message += '\n\n\nSign this message to prove you control this wallet.';

    // Sign with the main wallet
    const signature = await this.provider.request({
      method: 'personal_sign',
      params: [message, this.walletAddress]
    });

    // Create auth data
    const authData = {
      type: 'MAIN_WALLET_AUTH',
      walletAddress: this.walletAddress,
      message,
      signature,
      timestamp,
      nonce,
      ...(payload.paymentRequestId && { payment_request_id: payload.paymentRequestId }),
      ...(payload.codeChallenge && { code_challenge: payload.codeChallenge })
    };

    // Base64 encode
    const jwt = Buffer.from(JSON.stringify(authData)).toString('base64');
    this.logger.info(`Generated main wallet auth data: ${jwt}`);
    
    return jwt;
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
