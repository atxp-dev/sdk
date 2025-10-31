import { encodeFunctionData } from 'viem';
import { getPolygonUSDCAddress, type Hex } from '@atxp/client';
import { polygon } from 'viem/chains';
import BigNumber from 'bignumber.js';
import { ConsoleLogger, Logger, Currency, PaymentMaker, AccountId, PaymentIdentifier, Destination } from '@atxp/common';
import {
  buildES256KJWTMessage,
  completeES256KJWT
} from '@atxp/common';

const USDC_DECIMALS = 6;

export type MainWalletProvider = {
  request: (params: {
    method: string;
    params?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * Browser-based payment maker using direct wallet signing.
 * Each transaction requires user approval in their wallet.
 * User pays gas fees in POL.
 */
export class DirectWalletPaymentMaker implements PaymentMaker {
  private logger: Logger;
  private chainId: number;
  private usdcAddress: string;

  constructor(
    private walletAddress: string,
    private provider: MainWalletProvider,
    logger?: Logger,
    chainId: number = polygon.id
  ) {
    this.logger = logger || new ConsoleLogger();
    this.chainId = chainId;
    this.usdcAddress = getPolygonUSDCAddress(chainId);
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

    // Step 1: Build the JWT message (header.payload) that needs to be signed
    const { message } = buildES256KJWTMessage({
      walletAddress: this.walletAddress,
      codeChallenge: payload.codeChallenge,
      paymentRequestId: payload.paymentRequestId,
      accountId: payload.accountId,
    });

    this.logger.info(`Requesting signature for JWT message: ${message}`);

    // Step 2: Request signature from the wallet using personal_sign
    // The user will sign the JWT message (header.payload)
    // This returns a 65-byte ECDSA signature (130 hex chars + 0x prefix)
    const signature = await this.provider.request({
      method: 'personal_sign',
      params: [message, this.walletAddress]
    });

    this.logger.info(`Received signature: ${signature}`);

    // Step 3: Complete the JWT by adding the signature
    const jwtToken = completeES256KJWT({
      message,
      signature
    });

    this.logger.info(`Generated ES256K JWT: ${jwtToken}`);

    return jwtToken;
  }

  async makePayment(
    destinations: Destination[],
    _memo: string,
    _paymentRequestId?: string
  ): Promise<PaymentIdentifier | null> {
    // Filter to polygon chain destinations
    const polygonDestinations = destinations.filter(d => d.chain === 'polygon');

    if (polygonDestinations.length === 0) {
      this.logger.debug('MainWalletPaymentMaker: No polygon destinations found, cannot handle payment');
      return null; // Cannot handle these destinations
    }

    // Pick first polygon destination
    const dest = polygonDestinations[0];
    const amount = dest.amount;
    const currency = dest.currency;
    const receiver = dest.address;

    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported');
    }

    this.logger.info(`Making direct payment of ${amount} ${currency} to ${receiver} on Polygon`);

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
      chain: 'polygon',
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
