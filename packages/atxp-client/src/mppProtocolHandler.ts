import type { Logger, AccountId } from '@atxp/common';
import { AuthorizationError } from '@atxp/common';
import type { ProtocolHandler, ProtocolConfig } from './protocolHandler.js';
import type { ProspectivePayment } from './types.js';
import {
  MPP_ERROR_CODE,
  type MPPChallenge,
  parseMPPHeaders,
  parseMPPChallengesFromMCPError,
  hasMPPChallenge,
  hasMPPMCPError,
} from '@atxp/mpp';
import { BigNumber } from 'bignumber.js';
import { buildPaymentHeaders } from './paymentHeaders.js';

/**
 * Protocol handler for MPP (Machine Payments Protocol) payment challenges.
 *
 * Detects MPP challenges in two forms:
 * 1. HTTP level: HTTP 402 with WWW-Authenticate: Payment header
 * 2. MCP level: JSON-RPC error with code -32042 containing MPP data
 *
 * Handles the challenge by calling /authorize/auto on the accounts service
 * and retrying with an Authorization: Payment header.
 */
export class MPPProtocolHandler implements ProtocolHandler {
  readonly protocol = 'mpp';

  async canHandle(response: Response): Promise<boolean> {
    if (hasMPPChallenge(response)) return true;
    return hasMPPMCPError(response);
  }

  async handlePaymentChallenge(
    response: Response,
    originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig
  ): Promise<Response | null> {
    const { account, logger, approvePayment } = config;

    // Extract ALL challenges and body text from the response
    const extracted = await this.extractChallenges(response, logger);
    if (!extracted || extracted.challenges.length === 0) {
      logger.error('MPP: failed to extract challenge from response');
      return null;
    }
    const { challenges, bodyText } = extracted;

    // Use first challenge for approval display (all have the same amount)
    const primaryChallenge = challenges[0];

    const url = typeof originalRequest.url === 'string'
      ? originalRequest.url
      : originalRequest.url.toString();

    // Build prospective payment for approval
    const accountId = await account.getAccountId();
    const prospectivePayment = this.buildProspectivePayment(primaryChallenge, url, accountId);

    // Ask for approval
    const approved = await approvePayment(prospectivePayment);
    if (!approved) {
      logger.info('MPP: payment not approved');
      await this.reportFailure(config, prospectivePayment, new Error('Payment not approved'), primaryChallenge.network, true);
      return this.reconstructResponse(bodyText, response);
    }

    return this.authorizeAndRetry(challenges, prospectivePayment, originalRequest, config, bodyText, response);
  }

  /**
   * Extract ALL MPP challenges from response - tries HTTP headers first, then MCP error body.
   * Returns all challenges and the body text to avoid double-consumption.
   */
  private async extractChallenges(response: Response, logger: Logger): Promise<{ challenges: MPPChallenge[]; bodyText: string } | null> {
    // Read body once upfront to avoid double consumption (response.text() can only be called once)
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      // Body may not be available
    }

    // Try HTTP headers first (may contain multiple Payment challenges)
    const header = response.headers.get('WWW-Authenticate');
    if (header) {
      const challenges = parseMPPHeaders(header);
      if (challenges.length > 0) {
        logger.debug(`MPP: parsed ${challenges.length} challenge(s) from WWW-Authenticate header`);
        return { challenges, bodyText };
      }
    }

    // Try MCP error body
    try {
      const parsed = JSON.parse(bodyText);

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.error === 'object' &&
        parsed.error !== null &&
        parsed.error.code === MPP_ERROR_CODE
      ) {
        const challenges = parseMPPChallengesFromMCPError(parsed.error.data);
        if (challenges.length > 0) {
          logger.debug(`MPP: parsed ${challenges.length} challenge(s) from MCP error body`);
          return { challenges, bodyText };
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
   * Report a payment failure via the onPaymentFailure callback.
   */
  private async reportFailure(
    config: ProtocolConfig,
    payment: ProspectivePayment,
    error: Error,
    network: string,
    retryable: boolean
  ): Promise<void> {
    await config.onPaymentFailure({
      payment,
      error,
      attemptedNetworks: [network],
      failureReasons: new Map([[network, error]]),
      retryable,
      timestamp: new Date(),
    });
  }

  /**
   * Call /authorize/mpp on accounts service and retry the original request with the credential.
   * Sends all challenges to accounts — accounts picks the chain via feature flag.
   */
  private async authorizeAndRetry(
    challenges: MPPChallenge[],
    prospectivePayment: ProspectivePayment,
    originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig,
    bodyText: string,
    originalResponse: Response
  ): Promise<Response> {
    const { account, logger, fetchFn, onPayment } = config;
    const primaryChallenge = challenges[0];

    try {
      logger.debug('MPP: calling /authorize/auto on accounts service');

      let authorizeResult;
      try {
        authorizeResult = await account.authorize({
          protocols: ['mpp'],
          destination: typeof originalRequest.url === 'string' ? originalRequest.url : originalRequest.url.toString(),
          // Send all challenges — accounts picks the right one via ff:mpp-chain
          challenges,
        });
      } catch (authorizeError) {
        // AuthorizationError = server rejected the request (HTTP error from accounts)
        // Other errors = data validation or network failure
        if (authorizeError instanceof AuthorizationError) {
          logger.debug(`MPP: authorize rejected (${authorizeError.statusCode}), returning original response`);
          return this.reconstructResponse(bodyText, originalResponse);
        }
        throw authorizeError;
      }

      const retryHeaders = buildPaymentHeaders(authorizeResult, originalRequest.init?.headers);
      const retryInit: RequestInit = { ...originalRequest.init, headers: retryHeaders };

      logger.info('MPP: retrying request with Authorization: Payment header');
      const retryResponse = await fetchFn(originalRequest.url, retryInit);

      if (retryResponse.ok) {
        logger.info('MPP: payment accepted');
        await onPayment({ payment: prospectivePayment, transactionHash: primaryChallenge.id, network: primaryChallenge.network });
      } else {
        logger.warn(`MPP: request failed after payment with status ${retryResponse.status}`);
        await this.reportFailure(config, prospectivePayment, new Error(`Request failed with status ${retryResponse.status}`), primaryChallenge.network, false);
      }

      return retryResponse;
    } catch (error) {
      logger.error(`MPP: failed to handle payment challenge: ${error}`);
      const cause = error instanceof Error ? error : new Error(String(error));
      await this.reportFailure(config, prospectivePayment, cause, primaryChallenge.network, true);
      return this.reconstructResponse(bodyText, originalResponse);
    }
  }

  private reconstructResponse(body: string, original: Response): Response {
    return new Response(body || null, {
      status: original.status,
      statusText: original.statusText,
      headers: original.headers,
    });
  }

}
