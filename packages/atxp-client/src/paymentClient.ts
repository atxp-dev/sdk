import type { PaymentProtocol, Logger, Account, AuthorizeResult } from '@atxp/common';
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
 * Passes protocols through to account.authorize() which handles
 * protocol selection and authorization logic.
 */
export class PaymentClient {
  private logger: Logger;

  constructor(config: {
    logger: Logger;
  }) {
    this.logger = config.logger;
  }

  /**
   * Authorize a payment by delegating to the account's authorize method.
   *
   * PaymentClient passes the protocols array through to account.authorize(),
   * which selects the appropriate protocol and handles authorization.
   *
   * @param params.account - The account to authorize the payment through
   * @param params.protocols - Payment protocols the server/caller supports
   * @param params.destination - Payment destination address
   * @param params.amount - Payment amount
   * @param params.memo - Payment memo
   * @param params.paymentRequirements - X402 payment requirements
   * @param params.challenge - MPP challenge object
   * @returns AuthorizeResult with protocol and opaque credential
   */
  async authorize(params: {
    account: Account;
    protocols: PaymentProtocol[];
    amount?: BigNumber;
    destination: string;
    memo?: string;
    paymentRequirements?: unknown;
    challenge?: unknown;
  }): Promise<AuthorizeResult> {
    return params.account.authorize({
      protocols: params.protocols,
      amount: params.amount!,
      destination: params.destination,
      memo: params.memo,
      paymentRequirements: params.paymentRequirements,
      challenge: params.challenge,
    });
  }
}
