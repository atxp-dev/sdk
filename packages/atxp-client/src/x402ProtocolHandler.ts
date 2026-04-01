import type { ProtocolHandler, ProtocolConfig } from './protocolHandler.js';
import type { ProspectivePayment } from './types.js';
import { ATXPPaymentError } from './errors.js';
import { BigNumber } from 'bignumber.js';
import { buildPaymentHeaders } from './paymentHeaders.js';

/**
 * Type guard for X402 challenge body.
 */
interface X402Challenge {
  x402Version: number;
  accepts: Array<{
    network: string;
    scheme: string;
    payTo: string;
    maxAmountRequired: string | number;
    description?: string;
  }>;
}

function isX402Challenge(obj: unknown): obj is X402Challenge {
  if (typeof obj !== 'object' || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate.x402Version !== 'undefined' &&
    Array.isArray(candidate.accepts)
  );
}

/**
 * Protocol handler for X402 payment challenges.
 *
 * Detects HTTP 402 responses with x402Version in the JSON body.
 * Creates payment headers using the x402 library and retries the request.
 */
export class X402ProtocolHandler implements ProtocolHandler {
  readonly protocol = 'x402';

  async canHandle(response: Response): Promise<boolean> {
    if (response.status !== 402) return false;

    try {
      const cloned = response.clone();
      const body = await cloned.text();
      const parsed = JSON.parse(body);
      return isX402Challenge(parsed);
    } catch {
      return false;
    }
  }

  async handlePaymentChallenge(
    response: Response,
    originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig
  ): Promise<Response | null> {
    const { account, logger, fetchFn, approvePayment, onPayment, onPaymentFailure } = config;

    const responseBody = await response.text();
    let paymentChallenge: unknown;

    try {
      paymentChallenge = JSON.parse(responseBody);
    } catch {
      logger.error('X402: failed to parse challenge body');
      return null;
    }

    if (!isX402Challenge(paymentChallenge)) {
      return null;
    }

    try {
      const { selectPaymentRequirements } = await import('x402/client');

      const selectedPaymentRequirements = selectPaymentRequirements(
        paymentChallenge.accepts,
        undefined,
        'exact'
      );

      if (!selectedPaymentRequirements) {
        logger.info('X402: no suitable payment option found');
        return this.reconstructResponse(responseBody, response);
      }

      const amountInUsdc = Number(selectedPaymentRequirements.maxAmountRequired) / (10 ** 6);
      const network = selectedPaymentRequirements.network;
      logger.debug(`X402: payment required: ${amountInUsdc} USDC on ${network} to ${selectedPaymentRequirements.payTo}`);

      const url = typeof originalRequest.url === 'string' ? originalRequest.url : originalRequest.url.toString();
      const accountId = await account.getAccountId();
      const prospectivePayment: ProspectivePayment = {
        accountId,
        resourceUrl: url,
        resourceName: selectedPaymentRequirements.description || url,
        currency: 'USDC',
        amount: new BigNumber(amountInUsdc),
        iss: selectedPaymentRequirements.payTo
      };

      const approved = await approvePayment(prospectivePayment);
      if (!approved) {
        logger.info('X402: payment not approved');
        const error = new Error('Payment not approved');
        await onPaymentFailure({
          payment: prospectivePayment,
          error,
          attemptedNetworks: [network],
          failureReasons: new Map([[network, error]]),
          retryable: true,
          timestamp: new Date()
        });
        return this.reconstructResponse(responseBody, response);
      }

      // Authorize via account.authorize() — ATXPAccount calls the accounts
      // service, BaseAccount signs locally. No fallback — each account type
      // handles authorization according to its capabilities.
      const authorizeResult = await account.authorize({
        protocols: ['x402'],
        destination: url,
        paymentRequirements: selectedPaymentRequirements,
      });
      const paymentHeader = authorizeResult.credential;

      // Retry with X-PAYMENT header
      const retryHeaders = buildPaymentHeaders(
        { protocol: 'x402', credential: paymentHeader },
        originalRequest.init?.headers
      );
      const retryInit: RequestInit = { ...originalRequest.init, headers: retryHeaders };

      logger.info('X402: retrying request with X-PAYMENT header');
      const retryResponse = await fetchFn(originalRequest.url, retryInit);

      if (retryResponse.ok) {
        logger.info('X402: payment accepted');
        await onPayment({
          payment: prospectivePayment,
          transactionHash: paymentHeader.substring(0, 66),
          network
        });
      } else {
        logger.warn(`X402: request failed after payment with status ${retryResponse.status}`);
        const error = new Error(`Request failed with status ${retryResponse.status}`);
        await onPaymentFailure({
          payment: prospectivePayment,
          error,
          attemptedNetworks: [network],
          failureReasons: new Map([[network, error]]),
          retryable: false,
          timestamp: new Date()
        });
      }

      return retryResponse;
    } catch (error) {
      logger.error(`X402: failed to handle payment challenge: ${error}`);

      if (isX402Challenge(paymentChallenge) && paymentChallenge.accepts[0]) {
        const firstOption = paymentChallenge.accepts[0];
        const amount = firstOption.maxAmountRequired ? Number(firstOption.maxAmountRequired) / (10 ** 6) : 0;
        const url = typeof originalRequest.url === 'string' ? originalRequest.url : originalRequest.url.toString();
        const accountId = await account.getAccountId();
        const errorNetwork = firstOption.network || 'unknown';
        const typedError = error as Error;
        const isRetryable = typedError instanceof ATXPPaymentError ? typedError.retryable : true;
        await onPaymentFailure({
          payment: {
            accountId,
            resourceUrl: url,
            resourceName: firstOption.description || url,
            currency: 'USDC',
            amount: new BigNumber(amount),
            iss: firstOption.payTo || ''
          },
          error: typedError,
          attemptedNetworks: [errorNetwork],
          failureReasons: new Map([[errorNetwork, typedError]]),
          retryable: isRetryable,
          timestamp: new Date()
        });
      }

      return this.reconstructResponse(responseBody, response);
    }
  }

  private reconstructResponse(body: string, original: Response): Response {
    return new Response(body, {
      status: original.status,
      statusText: original.statusText,
      headers: original.headers
    });
  }

}
