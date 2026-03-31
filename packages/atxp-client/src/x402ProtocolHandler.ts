import type { FetchLike, Logger } from '@atxp/common';
import type { ProtocolHandler, ProtocolConfig } from './protocolHandler.js';
import type { ProspectivePayment } from './types.js';
import { ATXPPaymentError } from './errors.js';
import { BigNumber } from 'bignumber.js';

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
 * Configuration for X402 protocol handler.
 * accountsServer is the base URL for the accounts service (for /authorize/x402).
 */
/**
 * Type guard for accounts with origin and token properties (e.g., ATXPLocalAccount).
 */
interface AccountWithOrigin {
  origin: string;
  token: string;
  fetchFn?: FetchLike;
}

function hasOriginAndToken(account: unknown): account is AccountWithOrigin {
  const candidate = account as Record<string, unknown>;
  return typeof candidate?.origin === 'string' && typeof candidate?.token === 'string';
}

/**
 * Type guard for accounts with a getLocalAccount method.
 */
interface AccountWithLocalAccount {
  getLocalAccount: () => unknown;
}

function hasGetLocalAccount(account: unknown): account is AccountWithLocalAccount {
  const candidate = account as Record<string, unknown>;
  return typeof candidate?.getLocalAccount === 'function';
}

export interface X402ProtocolHandlerConfig {
  accountsServer?: string;
}

/**
 * Protocol handler for X402 payment challenges.
 *
 * Detects HTTP 402 responses with x402Version in the JSON body.
 * Creates payment headers using the x402 library and retries the request.
 */
export class X402ProtocolHandler implements ProtocolHandler {
  readonly protocol = 'x402';
  private accountsServer: string;

  constructor(config?: X402ProtocolHandlerConfig) {
    this.accountsServer = config?.accountsServer ?? 'https://accounts.atxp.ai';
  }

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
      const { selectPaymentRequirements, createPaymentHeader } = await import('x402/client');

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

      // Try /authorize/x402 on accounts service first
      logger.debug('X402: calling /authorize/x402 on accounts service');
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const atxpAcct = account as { token?: string };
      if (atxpAcct.token) {
        authHeaders['Authorization'] = `Basic ${Buffer.from(`${atxpAcct.token}:`).toString('base64')}`;
      }
      const authorizeController = new AbortController();
      const authorizeTimeout = setTimeout(() => authorizeController.abort(), 30000);
      let authorizeResponse: Response;
      try {
        authorizeResponse = await fetchFn(`${this.accountsServer}/authorize/x402`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            paymentRequirements: selectedPaymentRequirements
          }),
          signal: authorizeController.signal,
        });
      } finally {
        clearTimeout(authorizeTimeout);
      }

      let paymentHeader: string;

      if (authorizeResponse.ok) {
        const authorizeResult = await authorizeResponse.json() as Record<string, unknown>;
        if (!authorizeResult.paymentHeader || typeof authorizeResult.paymentHeader !== 'string') {
          throw new Error('X402: /authorize/x402 response missing or invalid paymentHeader');
        }
        paymentHeader = authorizeResult.paymentHeader;
      } else {
        // Fallback: use local signer
        logger.debug('X402: /authorize/x402 not available, falling back to local signing');
        const signer = await this.getLocalSigner(account);
        if (!signer) {
          throw new Error('Could not get signer for X402 payment');
        }

        await this.ensureCurrencyIfNeeded(account, amountInUsdc, fetchFn, logger);

        paymentHeader = await createPaymentHeader(
          signer,
          paymentChallenge.x402Version,
          selectedPaymentRequirements
        );
      }

      // Retry with X-PAYMENT header
      const retryHeaders = this.buildRetryHeaders(originalRequest.init?.headers, paymentHeader);
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

  private buildRetryHeaders(originalHeaders: HeadersInit | undefined, paymentHeader: string): Headers {
    let retryHeaders: Headers;
    if (originalHeaders instanceof Headers) {
      retryHeaders = new Headers(originalHeaders);
    } else if (originalHeaders) {
      retryHeaders = new Headers(originalHeaders as HeadersInit);
    } else {
      retryHeaders = new Headers();
    }
    retryHeaders.set('X-PAYMENT', paymentHeader);
    retryHeaders.set('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE');
    return retryHeaders;
  }

  private async getLocalSigner(account: unknown): Promise<unknown | null> {
    try {
      const { ATXPLocalAccount } = await import('./atxpLocalAccount.js');

      if (hasOriginAndToken(account)) {
        return ATXPLocalAccount.create(account.origin, account.token, account.fetchFn);
      }

      if (hasGetLocalAccount(account)) {
        return account.getLocalAccount();
      }

      return null;
    } catch {
      return null;
    }
  }

  private async ensureCurrencyIfNeeded(
    account: unknown,
    amountInUsdc: number,
    fetchFn: FetchLike,
    logger: Logger
  ): Promise<void> {
    if (!hasOriginAndToken(account)) return;
    const atxpAccount = account;

    logger.debug('X402: ensuring sufficient on-chain USDC');
    const ensureResponse = await (atxpAccount.fetchFn || fetchFn)(`${atxpAccount.origin}/ensure-currency`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${atxpAccount.token}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInUsdc.toString(),
        currency: 'USDC',
        chainType: 'ethereum'
      })
    });

    if (!ensureResponse.ok) {
      const errorText = await ensureResponse.text();
      throw new Error(`Failed to ensure sufficient USDC: ${errorText}`);
    }

    const result = await ensureResponse.json() as { message?: string };
    logger.info(`X402: currency ensured: ${result.message}`);
  }
}
