import { BigNumber } from "bignumber.js";
import { Currency } from "@atxp/common";

/**
 * Base class for all ATXP payment errors with structured error codes and actionable guidance
 */
export abstract class ATXPPaymentError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  abstract readonly actionableMessage: string;

  constructor(message: string, public readonly context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when the user's wallet has insufficient funds for a payment
 */
export class InsufficientFundsError extends ATXPPaymentError {
  readonly code = 'INSUFFICIENT_FUNDS';
  readonly retryable = true;
  readonly actionableMessage: string;

  constructor(
    public readonly currency: Currency,
    public readonly required: BigNumber,
    public readonly available?: BigNumber,
    public readonly network?: string
  ) {
    const shortfall = available ? required.minus(available).toString() : required.toString();
    const availableText = available ? `, Available: ${available}` : '';
    const networkText = network ? ` on ${network}` : '';

    super(
      `Payment failed due to insufficient ${currency} funds${networkText}. ` +
      `Required: ${required}${availableText}. ` +
      `Please ensure your account has adequate balance before retrying.`,
      { currency, required: required.toString(), available: available?.toString(), network, shortfall }
    );

    this.actionableMessage = available
      ? `Add at least ${shortfall} ${currency} to your ${network} wallet and try again.`
      : `Ensure your ${network} wallet has at least ${required} ${currency} and try again.`;
  }
}

/**
 * Thrown when a blockchain transaction is reverted
 */
export class TransactionRevertedError extends ATXPPaymentError {
  readonly code = 'TRANSACTION_REVERTED';
  readonly retryable = false;
  readonly actionableMessage: string;

  constructor(
    public readonly transactionHash: string,
    public readonly network: string,
    public readonly revertReason?: string
  ) {
    super(
      `Transaction ${transactionHash} reverted on ${network}${revertReason ? `: ${revertReason}` : ''}`,
      { transactionHash, network, revertReason }
    );

    // Provide specific guidance based on revert reason
    if (revertReason?.toLowerCase().includes('allowance')) {
      this.actionableMessage = 'Approve token spending before making the payment. You may need to increase the token allowance.';
    } else if (revertReason?.toLowerCase().includes('balance')) {
      this.actionableMessage = 'Ensure your wallet has sufficient token balance and native token for gas fees.';
    } else {
      this.actionableMessage = 'The transaction was rejected by the blockchain. Check the transaction details on a block explorer and verify your wallet settings.';
    }
  }
}

/**
 * Thrown when an unsupported currency is requested
 */
export class UnsupportedCurrencyError extends ATXPPaymentError {
  readonly code = 'UNSUPPORTED_CURRENCY';
  readonly retryable = false;
  readonly actionableMessage: string;

  constructor(
    public readonly currency: string,
    public readonly network: string,
    public readonly supportedCurrencies: string[]
  ) {
    super(
      `Currency ${currency} is not supported on ${network}`,
      { currency, network, supportedCurrencies }
    );

    this.actionableMessage = `Please use one of the supported currencies: ${supportedCurrencies.join(', ')}`;
  }
}

/**
 * Thrown when gas estimation fails for a transaction
 */
export class GasEstimationError extends ATXPPaymentError {
  readonly code = 'GAS_ESTIMATION_FAILED';
  readonly retryable = true;
  readonly actionableMessage = 'Unable to estimate gas for this transaction. Ensure you have sufficient funds for both the payment amount and gas fees, then try again.';

  constructor(
    public readonly network: string,
    public readonly reason?: string
  ) {
    super(
      `Failed to estimate gas on ${network}${reason ? `: ${reason}` : ''}`,
      { network, reason }
    );
  }
}

/**
 * Thrown when RPC/network connectivity fails
 */
export class RpcError extends ATXPPaymentError {
  readonly code = 'RPC_ERROR';
  readonly retryable = true;
  readonly actionableMessage = 'Unable to connect to the blockchain network. Please check your internet connection and try again.';

  constructor(
    public readonly network: string,
    public readonly rpcUrl?: string,
    public readonly originalError?: Error
  ) {
    super(
      `RPC call failed on ${network}${rpcUrl ? ` (${rpcUrl})` : ''}`,
      { network, rpcUrl, originalError: originalError?.message }
    );
  }
}

/**
 * Thrown when the user rejects a transaction in their wallet
 */
export class UserRejectedError extends ATXPPaymentError {
  readonly code = 'USER_REJECTED';
  readonly retryable = true;
  readonly actionableMessage = 'You cancelled the transaction. To complete the payment, please approve the transaction in your wallet.';

  constructor(public readonly network: string) {
    super(`User rejected transaction on ${network}`, { network });
  }
}

/**
 * Thrown when the payment server returns an error
 */
export class PaymentServerError extends ATXPPaymentError {
  readonly code: string;
  readonly retryable = true;
  readonly actionableMessage = 'The payment server encountered an error. Please try again in a few moments.';

  constructor(
    public readonly statusCode: number,
    public readonly endpoint: string,
    public readonly serverMessage?: string,
    errorCode?: string,
    public readonly details?: any
  ) {
    super(
      `Payment server returned ${statusCode} from ${endpoint}${serverMessage ? `: ${serverMessage}` : ''}`,
      { statusCode, endpoint, serverMessage, errorCode, details }
    );
    this.code = errorCode || 'PAYMENT_SERVER_ERROR';
  }
}

/**
 * Thrown when a payment request has expired
 */
export class PaymentExpiredError extends ATXPPaymentError {
  readonly code = 'PAYMENT_EXPIRED';
  readonly retryable = false;
  readonly actionableMessage = 'This payment request has expired. Please make a new request to the service.';

  constructor(public readonly paymentRequestId: string, public readonly expiresAt?: Date) {
    super(
      `Payment request ${paymentRequestId} has expired`,
      { paymentRequestId, expiresAt: expiresAt?.toISOString() }
    );
  }
}

/**
 * Generic network error for backward compatibility and uncategorized errors
 */
export class PaymentNetworkError extends ATXPPaymentError {
  readonly code = 'NETWORK_ERROR';
  readonly retryable = true;
  readonly actionableMessage = 'A network error occurred during payment processing. Please try again.';

  constructor(
    public readonly network: string,
    message: string,
    public readonly originalError?: Error
  ) {
    super(
      `Payment failed on ${network} network: ${message}`,
      { network, originalError: originalError?.message }
    );
  }
}
