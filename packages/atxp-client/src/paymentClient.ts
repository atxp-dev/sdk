import type { PaymentProtocol, ProtocolFlag, FetchLike, Logger, Account, AuthorizeResult } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

// Re-export AuthorizeResult from common so existing imports keep working
export type { AuthorizeResult } from '@atxp/common';

/**
 * Build protocol-specific payment headers for retrying a request after authorization.
 *
 * @param result - The authorization result containing protocol and credential
 * @param originalHeaders - Optional original request headers to preserve
 * @returns New Headers object with protocol-specific payment headers added
 */
export function buildPaymentHeaders(result: AuthorizeResult, originalHeaders?: HeadersInit): Headers {
  let headers: Headers;
  if (originalHeaders instanceof Headers) {
    headers = new Headers(originalHeaders);
  } else if (originalHeaders) {
    headers = new Headers(originalHeaders as HeadersInit);
  } else {
    headers = new Headers();
  }

  switch (result.protocol) {
    case 'x402':
      headers.set('X-PAYMENT', result.credential);
      headers.set('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE');
      break;
    case 'mpp':
      headers.set('Authorization', `Payment ${result.credential}`);
      break;
    case 'atxp':
      // ATXP uses the existing OAuth flow, not a payment header
      break;
  }

  return headers;
}

/**
 * Client for authorizing payments.
 *
 * Resolves the payment protocol via protocolFlag, then delegates to
 * account.authorize() for the actual authorization logic.
 */
export class PaymentClient {
  private protocolFlag?: ProtocolFlag;
  private logger: Logger;

  constructor(config: {
    protocolFlag?: ProtocolFlag;
    logger: Logger;
    /** @deprecated No longer used — authorization delegates to account.authorize() */
    accountsServer?: string;
    /** @deprecated No longer used — authorization delegates to account.authorize() */
    fetchFn?: FetchLike;
  }) {
    this.protocolFlag = config.protocolFlag;
    this.logger = config.logger;
  }

  /**
   * Authorize a payment by delegating to the account's authorize method.
   *
   * PaymentClient resolves the protocol (via explicit param or protocolFlag),
   * then delegates all protocol-specific logic to account.authorize().
   *
   * @param params.account - The account to authorize the payment through
   * @param params.userId - Passed to protocolFlag for protocol selection
   * @param params.destination - Payment destination address
   * @param params.protocol - Explicit protocol override (skips protocolFlag)
   * @param params.amount - Payment amount
   * @param params.memo - Payment memo
   * @param params.paymentRequirements - X402 payment requirements
   * @param params.challenge - MPP challenge object
   * @returns AuthorizeResult with protocol and opaque credential
   */
  async authorize(params: {
    account: Account;
    userId: string;
    destination: string;
    protocol?: PaymentProtocol;
    amount?: BigNumber;
    memo?: string;
    paymentRequirements?: unknown;
    challenge?: unknown;
  }): Promise<AuthorizeResult> {
    const { account, userId, destination } = params;

    // Determine protocol
    const protocol: PaymentProtocol = params.protocol
      ?? (this.protocolFlag ? this.protocolFlag(userId, destination) : 'atxp');

    // Delegate to the account's authorize method
    return account.authorize({
      protocol,
      amount: params.amount!,
      destination,
      memo: params.memo,
      paymentRequirements: params.paymentRequirements,
      challenge: params.challenge,
    });
  }
}
