import type { PaymentProtocol, ProtocolFlag, FetchLike, Logger, Account } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

/**
 * Result of authorizing a payment through the accounts service.
 * The credential is opaque to the caller -- its format depends on the protocol.
 */
export interface AuthorizeResult {
  protocol: PaymentProtocol;
  /** Opaque credential string whose interpretation depends on the protocol */
  credential: string;
}

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
 * Client for authorizing payments through the ATXP accounts service.
 *
 * Centralizes the logic for calling /authorize/{protocol} endpoints,
 * replacing duplicated code across protocol handlers.
 */
export class PaymentClient {
  private accountsServer: string;
  private protocolFlag?: ProtocolFlag;
  private logger: Logger;
  private fetchFn: FetchLike;

  constructor(config: {
    accountsServer: string;
    protocolFlag?: ProtocolFlag;
    logger: Logger;
    fetchFn?: FetchLike;
  }) {
    this.accountsServer = config.accountsServer;
    this.protocolFlag = config.protocolFlag;
    this.logger = config.logger;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  /**
   * Authorize a payment through the accounts service.
   *
   * @param params.account - Account with .token for Basic auth
   * @param params.userId - Passed to protocolFlag for protocol selection
   * @param params.destination - Passed to protocolFlag for protocol selection
   * @param params.protocol - Explicit protocol override (skips protocolFlag)
   * @param params.amount - Payment amount (ATXP)
   * @param params.memo - Payment memo (ATXP)
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

    // 1. Determine protocol
    const protocol: PaymentProtocol = params.protocol
      ?? (this.protocolFlag ? this.protocolFlag(userId, destination) : 'atxp');

    // 2. Build auth headers from account token
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    const atxpAcct = account as { token?: string };
    if (atxpAcct.token) {
      authHeaders['Authorization'] = `Basic ${Buffer.from(`${atxpAcct.token}:`).toString('base64')}`;
    }

    // 3. Build protocol-specific request body
    let body: Record<string, unknown>;
    switch (protocol) {
      case 'atxp':
        body = {
          amount: params.amount?.toString(),
          currency: 'USDC',
          receiver: destination,
          memo: params.memo,
        };
        break;
      case 'x402':
        body = { paymentRequirements: params.paymentRequirements };
        break;
      case 'mpp':
        body = { challenge: params.challenge };
        break;
      default:
        throw new Error(`PaymentClient: unsupported protocol '${protocol}'`);
    }

    // 4. Call /authorize/{protocol} with 30s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.accountsServer}/authorize/${protocol}`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PaymentClient: /authorize/${protocol} failed (${response.status}): ${errorText}`);
    }

    const responseBody = await response.json() as Record<string, unknown>;

    // 5. Extract credential based on protocol
    let credential: string;
    switch (protocol) {
      case 'atxp':
        credential = JSON.stringify(responseBody);
        break;
      case 'x402':
        if (!responseBody.paymentHeader || typeof responseBody.paymentHeader !== 'string') {
          throw new Error('PaymentClient: /authorize/x402 response missing or invalid paymentHeader');
        }
        credential = responseBody.paymentHeader;
        break;
      case 'mpp':
        if (!responseBody.credential || typeof responseBody.credential !== 'string') {
          throw new Error('PaymentClient: /authorize/mpp response missing or invalid credential');
        }
        credential = responseBody.credential;
        break;
      default:
        throw new Error(`PaymentClient: unsupported protocol '${protocol}'`);
    }

    return { protocol, credential };
  }
}
