import type { PaymentMaker, Hex } from '@atxp/client';
import {
  InsufficientFundsError as InsufficientFundsErrorClass,
  PaymentNetworkError as PaymentNetworkErrorClass,
  TransactionRevertedError,
  UnsupportedCurrencyError,
  GasEstimationError,
  RpcError,
  UserRejectedError,
  ATXPPaymentError
} from '@atxp/client';
import { Logger, Currency, AccountId, PaymentIdentifier, Destination } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';
import {
  Address,
  parseEther,
  publicActions,
  encodeFunctionData,
  WalletClient,
  PublicActions,
} from "viem";
import { base } from "viem/chains";
import { BigNumber } from "bignumber.js";
import { USDC_CONTRACT_ADDRESS_BASE } from './baseConstants.js';

// Type for the extended wallet client with public actions
type ExtendedWalletClient = WalletClient & PublicActions;

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
const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  {
      "constant": true,
      "inputs": [
          {
              "name": "_owner",
              "type": "address"
          }
      ],
      "name": "balanceOf",
      "outputs": [
          {
              "name": "balance",
              "type": "uint256"
          }
      ],
      "payable": false,
      "stateMutability": "view",
      "type": "function"
  }
];

export class BasePaymentMaker implements PaymentMaker {
  protected signingClient: ExtendedWalletClient;
  protected logger: Logger;

  constructor(baseRPCUrl: string, walletClient: WalletClient, logger?: Logger) {
    if (!baseRPCUrl) {
      throw new Error('baseRPCUrl was empty');
    }
    if (!walletClient) {
      throw new Error('walletClient was empty');
    }
    if(!walletClient.account) {
      throw new Error('walletClient.account was empty');
    }

    this.signingClient = walletClient.extend(publicActions) as ExtendedWalletClient;
    this.logger = logger ?? new ConsoleLogger();
  }

  getSourceAddress(_params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}): string {
    return this.signingClient.account!.address;
  }

  async generateJWT({paymentRequestId, codeChallenge, accountId}: {paymentRequestId: string, codeChallenge: string, accountId?: AccountId | null}): Promise<string> {
    const headerObj = { alg: 'ES256K' };

    const payloadObj = {
      sub: this.signingClient.account!.address,
      iss: 'accounts.atxp.ai',
      aud: 'https://auth.atxp.ai',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
      ...(paymentRequestId ? { payment_request_id: paymentRequestId } : {}),
      ...(accountId ? { account_id: accountId } : {}),
    } as Record<string, unknown>;

    const header = toBase64Url(JSON.stringify(headerObj));
    const payload = toBase64Url(JSON.stringify(payloadObj));
    const message = `${header}.${payload}`;

    const messageBytes = typeof Buffer !== 'undefined'
      ? Buffer.from(message, 'utf8')
      : new TextEncoder().encode(message);

    const signResult = await this.signingClient.signMessage({
      account: this.signingClient.account!,
      message: { raw: messageBytes },
    });

    // For ES256K, signature is typically 65 bytes (r,s,v)
    // Server expects the hex signature string (with 0x prefix) to be base64url encoded
    // This creates: base64url("0x6eb2565...") not base64url(rawBytes)
    // Pass the hex string directly to toBase64Url which will UTF-8 encode and base64url it
    const signature = toBase64Url(signResult);

    const jwt = `${header}.${payload}.${signature}`;
    this.logger.info(`Generated ES256K JWT: ${jwt}`);
    return jwt;
  }

  async makePayment(destinations: Destination[], _memo: string, _paymentRequestId?: string): Promise<PaymentIdentifier | null> {
    // Filter to base chain destinations
    const baseDestinations = destinations.filter(d => d.chain === 'base');

    if (baseDestinations.length === 0) {
      this.logger.debug('BasePaymentMaker: No base destinations found, cannot handle payment');
      return null; // Cannot handle these destinations
    }

    // Pick first base destination
    const dest = baseDestinations[0];
    const amount = dest.amount;
    const currency = dest.currency;
    const receiver = dest.address;

    if (currency.toUpperCase() !== 'USDC') {
      throw new UnsupportedCurrencyError(currency, 'base', ['USDC']);
    }

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver} on Base from ${this.signingClient.account!.address}`);

    try {
      // Check balance before attempting payment
      const balanceRaw = await this.signingClient.readContract({
        address: USDC_CONTRACT_ADDRESS_BASE as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.signingClient.account!.address],
      }) as bigint;

      const balance = new BigNumber(balanceRaw.toString()).dividedBy(10 ** USDC_DECIMALS);

      if (balance.lt(amount)) {
        this.logger.warn(`Insufficient ${currency} balance for payment. Required: ${amount}, Available: ${balance}`);
        throw new InsufficientFundsErrorClass(currency, amount, balance, 'base');
      }

      // Convert amount to USDC units (6 decimals) as BigInt
      const amountInUSDCUnits = BigInt(amount.multipliedBy(10 ** USDC_DECIMALS).toFixed(0));

      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [receiver as Address, amountInUSDCUnits],
      });
      const hash = await this.signingClient.sendTransaction({
        chain: base,
        account: this.signingClient.account!,
        to: USDC_CONTRACT_ADDRESS_BASE,
        data: data,
        value: parseEther('0'),
        maxPriorityFeePerGas: parseEther('0.000000001')
      });

      // Wait for transaction confirmation with more blocks to ensure propagation
      this.logger.info(`Waiting for transaction confirmation: ${hash}`);
      const receipt = await this.signingClient.waitForTransactionReceipt({
        hash: hash as Hex,
        confirmations: 1
      });

      if (receipt.status === 'reverted') {
        // Try to extract revert reason if available
        // Note: viem doesn't provide revert reason in receipt, would need additional call
        throw new TransactionRevertedError(hash, 'base');
      }

      this.logger.info(`Transaction confirmed: ${hash} in block ${receipt.blockNumber}`);

      // Return payment result with chain and currency
      return {
        transactionId: hash,
        chain: 'base',
        currency: 'USDC'
      };
    } catch (error) {
      // Re-throw our custom payment errors
      if (error instanceof ATXPPaymentError) {
        throw error;
      }

      // Categorize viem/blockchain errors
      const errorMessage = (error as Error).message || '';
      const errorName = (error as Error).name || '';

      // User rejected in wallet
      if (errorMessage.includes('User rejected') ||
          errorMessage.includes('user rejected') ||
          errorMessage.includes('User denied') ||
          errorName === 'UserRejectedRequestError') {
        throw new UserRejectedError('base');
      }

      // Gas estimation failed
      if (errorMessage.includes('gas') &&
          (errorMessage.includes('estimation') || errorMessage.includes('estimate'))) {
        throw new GasEstimationError('base', errorMessage);
      }

      // RPC/network errors
      if (errorMessage.includes('fetch failed') ||
          errorMessage.includes('network') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('ECONNREFUSED') ||
          errorMessage.includes('ETIMEDOUT') ||
          errorName === 'FetchError') {
        throw new RpcError('base', undefined, error as Error);
      }

      // Fallback to generic network error with original error attached
      throw new PaymentNetworkErrorClass('base', errorMessage || 'Unknown error', error as Error);
    }
  }

}