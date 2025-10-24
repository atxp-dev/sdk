import { encodeFunctionData, toHex } from 'viem';
import { getBaseUSDCAddress, type Hex } from '@atxp/client';
import { base } from 'viem/chains';
import BigNumber from 'bignumber.js';
import { ConsoleLogger, Logger, Currency, PaymentMaker, AccountId, PaymentIdentifier, Destination, Chain } from '@atxp/common';
import {
  createEIP1271JWT,
  createEIP1271AuthData,
  constructEIP1271Message
} from '@atxp/common';

const USDC_DECIMALS = 6;

export type MainWalletProvider = {
  request: (params: { 
    method: string; 
    params?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export class MainWalletPaymentMaker implements PaymentMaker {
  private logger: Logger;
  private chainId: number;
  private usdcAddress: string;

  constructor(
    private walletAddress: string,
    private provider: MainWalletProvider,
    logger?: Logger,
    chainId: number = base.id
  ) {
    this.logger = logger || new ConsoleLogger();
    this.chainId = chainId;
    this.usdcAddress = getBaseUSDCAddress(chainId);
  }

  getSourceAddress(_params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}): string {
    return this.walletAddress;
  }

  async generateJWT(payload: {
    paymentRequestId: string;
    codeChallenge: string;
    accountId?: AccountId | null;
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
      paymentRequestId: payload.paymentRequestId,
      ...(payload.accountId ? { accountId: payload.accountId } : {}),
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
      paymentRequestId: payload.paymentRequestId,
      ...(payload.accountId ? { accountId: payload.accountId } : {}),
    });

    const jwtToken = createEIP1271JWT(authData);

    this.logger.info(`Generated EIP-1271 JWT: ${jwtToken}`);

    return jwtToken;
  }

  async makePayment(
    destinations: Destination[],
    _memo: string,
    _paymentRequestId?: string
  ): Promise<PaymentIdentifiers | null> {
    // Filter to base chain destinations
    const baseDestinations = destinations.filter(d => d.chain === 'base');

    if (baseDestinations.length === 0) {
      this.logger.debug('MainWalletPaymentMaker: No base destinations found, cannot handle payment');
      return null; // Cannot handle these destinations
    }

    // Pick first base destination
    const dest = baseDestinations[0];
    const amount = dest.amount;
    const currency = dest.currency;
    const receiver = dest.address;

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
        to: this.usdcAddress,
        data: transferData,
        value: '0x0'
      }]
    });

    this.logger.info(`Transaction submitted. TxHash: ${txHash}`);

    // Wait for confirmations
    const CONFIRMATIONS = 2;
    await this.waitForTransactionConfirmations(txHash, CONFIRMATIONS);

    // Return payment result with chain and currency
    return {
      transactionId: txHash,
      chain: 'base',
      currency: 'USDC'
    };
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
