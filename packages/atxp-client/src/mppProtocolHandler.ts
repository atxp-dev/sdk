import type { FetchLike, Logger, AccountId } from '@atxp/common';
import type { ProtocolHandler, ProtocolConfig } from './protocolHandler.js';
import type { ProspectivePayment } from './types.js';
import {
  MPP_ERROR_CODE,
  type MPPChallenge,
  parseMPPHeader,
  parseMPPFromMCPError,
  hasMPPChallenge,
} from '@atxp/mpp';
import { BigNumber } from 'bignumber.js';

/**
 * Configuration for MPP protocol handler.
 */
export interface MPPProtocolHandlerConfig {
  accountsServer?: string;
}

/**
 * Protocol handler for MPP (Machine Payments Protocol) payment challenges.
 *
 * Detects MPP challenges in two forms:
 * 1. HTTP level: HTTP 402 with WWW-Authenticate: Payment header
 * 2. MCP level: JSON-RPC error with code -32042 containing MPP data
 *
 * Handles the challenge by calling /authorize/mpp on the accounts service
 * and retrying with an Authorization: Payment header.
 */
export class MPPProtocolHandler implements ProtocolHandler {
  readonly protocol = 'mpp';
  private accountsServer: string;

  constructor(config?: MPPProtocolHandlerConfig) {
    this.accountsServer = config?.accountsServer ?? 'https://accounts.atxp.ai';
  }

  async canHandle(response: Response): Promise<boolean> {
    // Check HTTP-level MPP challenge (WWW-Authenticate: Payment header)
    if (hasMPPChallenge(response)) {
      return true;
    }

    // Check MCP-level MPP challenge (JSON-RPC error code -32042)
    try {
      const cloned = response.clone();
      const body = await cloned.text();
      if (!body) return false;

      const parsed = JSON.parse(body);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.error === 'object' &&
        parsed.error !== null &&
        parsed.error.code === MPP_ERROR_CODE
      ) {
        const challenge = parseMPPFromMCPError(parsed.error.data);
        return challenge !== null;
      }

      return false;
    } catch {
      return false;
    }
  }

  async handlePaymentChallenge(
    response: Response,
    originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig
  ): Promise<Response | null> {
    const { account, logger, approvePayment, onPaymentFailure } = config;

    // Extract the challenge and body text from the response
    const extracted = await this.extractChallenge(response, logger);
    if (!extracted) {
      logger.error('MPP: failed to extract challenge from response');
      return null;
    }
    const { challenge, bodyText } = extracted;

    const url = typeof originalRequest.url === 'string'
      ? originalRequest.url
      : originalRequest.url.toString();

    // Build prospective payment for approval
    const accountId = await account.getAccountId();
    const prospectivePayment = this.buildProspectivePayment(challenge, url, accountId);

    // Ask for approval
    const approved = await approvePayment(prospectivePayment);
    if (!approved) {
      logger.info('MPP: payment not approved');
      const error = new Error('Payment not approved');
      await onPaymentFailure({
        payment: prospectivePayment,
        error,
        attemptedNetworks: [challenge.network],
        failureReasons: new Map([[challenge.network, error]]),
        retryable: true,
        timestamp: new Date(),
      });
      return this.reconstructResponse(bodyText, response.status);
    }

    return this.authorizeAndRetry(challenge, prospectivePayment, originalRequest, config, bodyText, response.status);
  }

  /**
   * Extract MPP challenge from response - tries HTTP header first, then MCP error body.
   * Returns both the challenge and the body text to avoid double-consumption.
   */
  private async extractChallenge(response: Response, logger: Logger): Promise<{ challenge: MPPChallenge; bodyText: string } | null> {
    // Try HTTP header first
    const header = response.headers.get('WWW-Authenticate');
    if (header) {
      const challenge = parseMPPHeader(header);
      if (challenge) {
        logger.debug('MPP: parsed challenge from WWW-Authenticate header');
        // Read body text for later reconstruction even though we don't need it for parsing
        let bodyText = '';
        try {
          bodyText = await response.text();
        } catch {
          // Body may not be available
        }
        return { challenge, bodyText };
      }
    }

    // Try MCP error body
    try {
      const bodyText = await response.text();
      const parsed = JSON.parse(bodyText);

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.error === 'object' &&
        parsed.error !== null &&
        parsed.error.code === MPP_ERROR_CODE
      ) {
        const challenge = parseMPPFromMCPError(parsed.error.data);
        if (challenge) {
          logger.debug('MPP: parsed challenge from MCP error body');
          return { challenge, bodyText };
        }
      }
    } catch {
      // Not JSON or malformed
    }

    return null;
  }

  /**
   * Build a ProspectivePayment from an MPP challenge.
   */
  private buildProspectivePayment(challenge: MPPChallenge, url: string, accountId: AccountId): ProspectivePayment {
    const amountNum = Number(challenge.amount) / (10 ** 6);
    return {
      accountId,
      resourceUrl: url,
      resourceName: url,
      currency: challenge.currency as ProspectivePayment['currency'],
      amount: new BigNumber(amountNum),
      iss: challenge.recipient,
    };
  }

  /**
   * Call /authorize/mpp on accounts service and retry the original request with the credential.
   */
  private async authorizeAndRetry(
    challenge: MPPChallenge,
    prospectivePayment: ProspectivePayment,
    originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig,
    bodyText: string,
    originalStatus?: number
  ): Promise<Response> {
    const { logger, fetchFn, onPayment, onPaymentFailure } = config;

    try {
      logger.debug('MPP: calling /authorize/mpp on accounts service');
      const authorizeResponse = await fetchFn(`${this.accountsServer}/authorize/mpp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge }),
      });

      if (!authorizeResponse.ok) {
        // Graceful fallback: return original response with original status
        logger.debug('MPP: /authorize/mpp not available, returning original response');
        return this.reconstructResponse(bodyText, originalStatus);
      }

      const authorizeResult = await authorizeResponse.json() as { credential: string; expiresAt: string };
      const credential = authorizeResult.credential;

      // Retry request with Authorization: Payment header
      const retryHeaders = this.buildRetryHeaders(originalRequest.init?.headers, credential);
      const retryInit: RequestInit = { ...originalRequest.init, headers: retryHeaders };

      logger.info('MPP: retrying request with Authorization: Payment header');
      const retryResponse = await fetchFn(originalRequest.url, retryInit);

      if (retryResponse.ok) {
        logger.info('MPP: payment accepted');
        await onPayment({
          payment: prospectivePayment,
          transactionHash: challenge.id,
          network: challenge.network,
        });
      } else {
        logger.warn(`MPP: request failed after payment with status ${retryResponse.status}`);
        const error = new Error(`Request failed with status ${retryResponse.status}`);
        await onPaymentFailure({
          payment: prospectivePayment,
          error,
          attemptedNetworks: [challenge.network],
          failureReasons: new Map([[challenge.network, error]]),
          retryable: false,
          timestamp: new Date(),
        });
      }

      return retryResponse;
    } catch (error) {
      logger.error(`MPP: failed to handle payment challenge: ${error}`);

      const typedError = error as Error;
      await onPaymentFailure({
        payment: prospectivePayment,
        error: typedError,
        attemptedNetworks: [challenge.network],
        failureReasons: new Map([[challenge.network, typedError]]),
        retryable: true,
        timestamp: new Date(),
      });

      return this.reconstructResponse(bodyText);
    }
  }

  private reconstructResponse(body: string, status?: number): Response {
    return new Response(body || null, {
      status: status ?? 402,
    });
  }

  private buildRetryHeaders(originalHeaders: HeadersInit | undefined, credential: string): Headers {
    let retryHeaders: Headers;
    if (originalHeaders instanceof Headers) {
      retryHeaders = new Headers(originalHeaders);
    } else if (originalHeaders) {
      retryHeaders = new Headers(originalHeaders as HeadersInit);
    } else {
      retryHeaders = new Headers();
    }
    retryHeaders.set('Authorization', `Payment ${credential}`);
    return retryHeaders;
  }
}
