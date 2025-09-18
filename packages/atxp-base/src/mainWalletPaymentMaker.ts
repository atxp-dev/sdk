import { PaymentMaker, EIP3009Authorization, PaymentNetworkError } from '@atxp/client';
import { encodeFunctionData, toHex } from 'viem';
import { USDC_CONTRACT_ADDRESS_BASE, type Hex } from '@atxp/client';
import BigNumber from 'bignumber.js';
import { ConsoleLogger, Logger, Currency } from '@atxp/common';
import { 
  createEIP1271JWT, 
  createEIP1271AuthData,
  constructEIP1271Message 
} from './eip1271JwtHelper.js';

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

    // Generate EIP-1271 auth data for main wallet authentication
    const timestamp = Math.floor(Date.now() / 1000);
    
    const message = constructEIP1271Message({
      walletAddress: this.walletAddress,
      timestamp,
      codeChallenge: payload.codeChallenge,
      paymentRequestId: payload.paymentRequestId
    });

    // Sign with the main wallet
    // Coinbase Wallet requires hex-encoded messages, while other wallets may accept plain strings
    let messageToSign: string;
    
    // Check if this is Coinbase Wallet by looking for provider properties
    const providerWithCoinbase = this.provider as MainWalletProvider & {
      isCoinbaseWallet?: boolean;
      isCoinbaseBrowser?: boolean;
    };
    const isCoinbaseWallet = providerWithCoinbase.isCoinbaseWallet || 
                            providerWithCoinbase.isCoinbaseBrowser;
    
    if (isCoinbaseWallet) {
      // Coinbase Wallet requires hex-encoded messages
      messageToSign = toHex(message);
      this.logger.info('Using hex-encoded message for Coinbase Wallet');
    } else {
      // Other wallets (MetaMask, etc.) typically accept plain strings
      messageToSign = message;
      this.logger.info('Using plain string message for wallet');
    }
    
    const signature = await this.provider.request({
      method: 'personal_sign',
      params: [messageToSign, this.walletAddress]
    });

    const authData = createEIP1271AuthData({
      walletAddress: this.walletAddress,
      message,
      signature,
      timestamp,
      codeChallenge: payload.codeChallenge,
      paymentRequestId: payload.paymentRequestId
    });

    const jwtToken = createEIP1271JWT(authData);
    
    this.logger.info(`Generated EIP-1271 JWT: ${jwtToken}`);
    
    return jwtToken;
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

  async createPaymentAuthorization(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<EIP3009Authorization> {
    // MainWalletPaymentMaker doesn't support EIP-3009 payment authorizations
    throw new PaymentNetworkError('EIP-3009 payment authorizations are not supported by MainWalletPaymentMaker');
  }
}
