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
  toHex,
} from "viem";
import { BigNumber } from "bignumber.js";
import { PATHUSD_CONTRACT_ADDRESS_TEMPO, getTempoChain } from './tempoConstants.js';

// Type for the extended wallet client with public actions
type ExtendedWalletClient = WalletClient & PublicActions;

// Helper function to convert to base64url that works in both Node.js and browsers
function toBase64Url(data: string): string {
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(data).toString('base64')
    : btoa(data);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const PATHUSD_DECIMALS = 6;

const TIP20_ABI = [
  // Standard ERC-20 transfer
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
  // TIP-20 transferWithMemo
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
      { name: "_memo", type: "bytes" },
    ],
    name: "transferWithMemo",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  // balanceOf
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  }
] as const;

export class TempoPaymentMaker implements PaymentMaker {
  protected signingClient: ExtendedWalletClient;
  protected logger: Logger;
  protected chainId: number;

  constructor(rpcUrl: string, walletClient: WalletClient, chainId?: number, logger?: Logger) {
    if (!rpcUrl) {
      throw new Error('rpcUrl was empty');
    }
    if (!walletClient) {
      throw new Error('walletClient was empty');
    }
    if (!walletClient.account) {
      throw new Error('walletClient.account was empty');
    }

    this.signingClient = walletClient.extend(publicActions) as ExtendedWalletClient;
    this.logger = logger ?? new ConsoleLogger();
    this.chainId = chainId ?? 4217;
  }

  getSourceAddress(_params: { amount: BigNumber, currency: Currency, receiver: string, memo: string }): string {
    return this.signingClient.account!.address;
  }

  async generateJWT({ paymentRequestId, codeChallenge, accountId }: { paymentRequestId: string, codeChallenge: string, accountId?: AccountId | null }): Promise<string> {
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

    const signature = toBase64Url(signResult);

    const jwt = `${header}.${payload}.${signature}`;
    this.logger.debug(`Generated ES256K JWT: ${jwt}`);
    return jwt;
  }

  /**
   * Check balance and throw InsufficientFundsError if insufficient.
   */
  private async checkBalance(amount: BigNumber, currency: Currency): Promise<void> {
    const balanceRaw = await this.signingClient.readContract({
      address: PATHUSD_CONTRACT_ADDRESS_TEMPO as Address,
      abi: TIP20_ABI,
      functionName: 'balanceOf',
      args: [this.signingClient.account!.address],
    }) as bigint;

    const balance = new BigNumber(balanceRaw.toString()).dividedBy(10 ** PATHUSD_DECIMALS);

    if (balance.lt(amount)) {
      this.logger.warn(`Insufficient ${currency} balance for payment. Required: ${amount}, Available: ${balance}`);
      throw new InsufficientFundsErrorClass(currency, amount, balance, 'tempo');
    }
  }

  /**
   * Classify viem/blockchain errors into ATXPPaymentError subclasses.
   */
  private classifyError(error: unknown): Error {
    if (error instanceof ATXPPaymentError) {
      return error;
    }

    const errorMessage = (error as Error).message || '';
    const errorName = (error as Error).name || '';

    // User rejected in wallet
    if (errorMessage.includes('User rejected') ||
        errorMessage.includes('user rejected') ||
        errorMessage.includes('User denied') ||
        errorName === 'UserRejectedRequestError') {
      return new UserRejectedError('tempo');
    }

    // Gas estimation failed
    if (errorMessage.includes('gas') &&
        (errorMessage.includes('estimation') || errorMessage.includes('estimate'))) {
      return new GasEstimationError('tempo', errorMessage);
    }

    // RPC/network errors
    if (errorMessage.includes('fetch failed') ||
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorName === 'FetchError') {
      return new RpcError('tempo', undefined, error as Error);
    }

    // Fallback to generic network error with original error attached
    return new PaymentNetworkErrorClass('tempo', errorMessage || 'Unknown error', error as Error);
  }

  async makePayment(destinations: Destination[], memo: string, _paymentRequestId?: string): Promise<PaymentIdentifier | null> {
    // Filter to tempo chain destinations
    const tempoDestinations = destinations.filter(d => d.chain === 'tempo');

    if (tempoDestinations.length === 0) {
      this.logger.debug('TempoPaymentMaker: No tempo destinations found, cannot handle payment');
      return null;
    }

    // Pick first tempo destination
    const dest = tempoDestinations[0];
    const amount = dest.amount;
    const currency = dest.currency;
    const receiver = dest.address;

    if (currency.toUpperCase() !== 'USDC') {
      throw new UnsupportedCurrencyError(currency, 'tempo', ['USDC']);
    }

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver} on Tempo from ${this.signingClient.account!.address}`);

    const chain = getTempoChain(this.chainId);

    try {
      // Check balance before attempting payment
      await this.checkBalance(amount, currency);

      // Convert amount to pathUSD units (6 decimals) as BigInt
      const amountInUnits = BigInt(amount.multipliedBy(10 ** PATHUSD_DECIMALS).toFixed(0));

      let data: Hex;
      if (memo && memo.length > 0) {
        // Use transferWithMemo when a memo is provided
        const memoBytes = toHex(new TextEncoder().encode(memo));
        data = encodeFunctionData({
          abi: TIP20_ABI,
          functionName: "transferWithMemo",
          args: [receiver as Address, amountInUnits, memoBytes],
        });
      } else {
        // Use standard transfer when no memo
        data = encodeFunctionData({
          abi: TIP20_ABI,
          functionName: "transfer",
          args: [receiver as Address, amountInUnits],
        });
      }

      const hash = await this.signingClient.sendTransaction({
        chain,
        account: this.signingClient.account!,
        to: PATHUSD_CONTRACT_ADDRESS_TEMPO as Address,
        data: data,
        value: parseEther('0'),
      });

      // Wait for transaction confirmation
      this.logger.info(`Waiting for transaction confirmation: ${hash}`);
      const receipt = await this.signingClient.waitForTransactionReceipt({
        hash: hash as Hex,
        confirmations: 1
      });

      if (receipt.status === 'reverted') {
        throw new TransactionRevertedError(hash, 'tempo');
      }

      this.logger.info(`Transaction confirmed: ${hash} in block ${receipt.blockNumber}`);

      return {
        transactionId: hash,
        chain: 'tempo',
        currency: 'USDC'
      };
    } catch (error) {
      throw this.classifyError(error);
    }
  }
}
