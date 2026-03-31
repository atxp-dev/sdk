import type { Account, Logger, FetchLike } from '@atxp/common';
import type { ProspectivePayment, PaymentFailureContext } from './types.js';

/**
 * Configuration passed to protocol handlers.
 */
export interface ProtocolConfig {
  account: Account;
  logger: Logger;
  fetchFn: FetchLike;
  approvePayment: (payment: ProspectivePayment) => Promise<boolean>;
  onPayment: (args: { payment: ProspectivePayment; transactionHash: string; network: string }) => Promise<void>;
  onPaymentFailure: (context: PaymentFailureContext) => Promise<void>;
}

/**
 * Strategy interface for handling different payment protocol challenges.
 *
 * Implementations detect whether a response contains a payment challenge
 * they can handle, and execute the payment flow if so.
 */
export interface ProtocolHandler {
  /** Unique protocol identifier */
  readonly protocol: string;

  /**
   * Check if this handler can handle the given response.
   * Must not consume the response body (use clone if needed).
   */
  canHandle(response: Response): Promise<boolean>;

  /**
   * Handle a payment challenge from the response.
   * Returns the retry response after payment, or null if the challenge couldn't be handled.
   */
  handlePaymentChallenge(
    response: Response,
    originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig
  ): Promise<Response | null>;
}
