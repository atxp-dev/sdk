import type { ProtocolHandler, ProtocolConfig } from './protocolHandler.js';
import { buildPaymentHeaders } from './paymentHeaders.js';
import { BigNumber } from 'bignumber.js';

/**
 * Protocol handler exclusively for ATXPAccount users.
 *
 * Delegates ALL protocol decisions to accounts /authorize/auto.
 * The server decides which protocol to use (ATXP, X402, or MPP)
 * and returns the appropriate credential. This handler just maps
 * the returned protocol to the correct HTTP header and retries.
 *
 * This handler is the ONLY handler used for ATXPAccount — no other
 * protocol handlers are allowed. This ensures all payments go through
 * accounts' authorize flow.
 */
export class ATXPAccountHandler implements ProtocolHandler {
  readonly protocol = 'atxp-account';

  async canHandle(response: Response): Promise<boolean> {
    return response.status === 402;
  }

  async handlePaymentChallenge(
    response: Response,
    originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig
  ): Promise<Response | null> {
    const { account, logger, fetchFn } = config;

    // Extract challenge data from the 402 response body
    let challengeData: Record<string, unknown> = {};
    try {
      challengeData = await response.clone().json();
    } catch {
      // Body might not be JSON
    }

    // Build authorize params from the challenge data.
    const authorizeParams = await buildAuthorizeParams(challengeData, fetchFn, logger);

    if (!authorizeParams.amount) {
      logger.error(`ATXPAccountHandler: no amount in challenge data, cannot authorize. Challenge keys: ${Object.keys(challengeData).join(', ')}`);
      return null;
    }

    // Delegate to account.authorize() → accounts /authorize/auto
    logger.info('ATXPAccountHandler: delegating to account.authorize()');
    let result;
    try {
      result = await account.authorize({
        protocols: ['atxp', 'x402', 'mpp'],
        amount: authorizeParams.amount ? new BigNumber(String(authorizeParams.amount)) : undefined,
        destination: authorizeParams.destination as string | undefined,
        paymentRequirements: authorizeParams.paymentRequirements,
        challenge: authorizeParams.challenge,
        challenges: authorizeParams.challenges as unknown[] | undefined,
      });
    } catch (error) {
      logger.error(`ATXPAccountHandler: authorize failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }

    if (!result || !result.credential) {
      logger.warn('ATXPAccountHandler: authorize returned no credential');
      return null;
    }

    logger.info(`ATXPAccountHandler: authorized via ${result.protocol}, retrying request`);

    // Map the returned protocol to the correct HTTP header
    const retryHeaders = buildPaymentHeaders(result, originalRequest.init?.headers);
    const retryInit: RequestInit = { ...originalRequest.init, headers: retryHeaders };

    return fetchFn(originalRequest.url, retryInit);
  }
}

/**
 * Build authorize parameters from omni-challenge data.
 * Fetches the payment request if needed to get destination details.
 */
async function buildAuthorizeParams(
  data: Record<string, unknown>,
  fetchFn: (url: string | URL, init?: RequestInit) => Promise<Response>,
  logger: { info: (msg: string) => void; debug: (msg: string) => void; warn: (msg: string) => void },
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};

  // Try to get amount from challenge
  if (data.chargeAmount) params.amount = String(data.chargeAmount);

  // Pass full X402 accepts array to accounts — accounts picks the chain
  // via ff:x402-chain feature flag (same pattern as MPP multi-chain challenges).
  if (data.x402) {
    const x402 = data.x402 as { x402Version?: number; accepts?: Array<Record<string, unknown>> };
    const chainAccepts = x402.accepts?.filter(
      (a): a is Record<string, unknown> & { network: string } =>
        typeof a.network === 'string' && a.network !== 'atxp'
    );

    if (chainAccepts && chainAccepts.length > 0) {
      // Send full { x402Version, accepts } so accounts can pick via feature flag.
      // Add defaults for fields the authorize endpoint requires.
      params.paymentRequirements = {
        x402Version: x402.x402Version ?? 2,
        accepts: chainAccepts.map(a => ({
          ...a,
          mimeType: (a.mimeType as string) || 'application/json',
          asset: (a.asset as string) || 'USDC',
        })),
      };
      // Extract destination/amount from the first option for generic fields
      const first = chainAccepts[0];
      if (first.payTo) params.destination = first.payTo as string;
      if (first.network) params.network = first.network;
      if (first.amount && !params.amount) params.amount = first.amount as string;
    }
  }

  // Try MPP data for destination.
  // data.mpp may be a single challenge or an array of challenges (multi-chain).
  if (data.mpp) {
    const mppArray = Array.isArray(data.mpp) ? data.mpp : [data.mpp];
    // Send all challenges to accounts — it picks the chain via feature flag
    params.challenges = mppArray;
    // Extract destination/amount from the first challenge
    const firstMpp = mppArray[0] as { recipient?: string; amount?: string } | undefined;
    if (firstMpp?.recipient && !params.destination) params.destination = firstMpp.recipient;
    if (firstMpp?.amount && !params.amount) params.amount = firstMpp.amount;
  }

  // If we still don't have a destination, fetch the payment request to get it
  if (!params.destination && data.paymentRequestUrl) {
    try {
      logger.debug(`ATXPAccountHandler: fetching payment request for destination info`);
      const prResponse = await fetchFn(String(data.paymentRequestUrl));
      if (prResponse.ok) {
        const pr = await prResponse.json() as { options?: Array<{ address?: string; network?: string; amount?: string | number }> };
        if (pr.options?.[0]) {
          const opt = pr.options[0];
          if (opt.address) params.destination = opt.address;
          if (opt.network) params.network = opt.network;
          if (opt.amount && !params.amount) params.amount = String(opt.amount);
        }
      }
    } catch (error) {
      logger.warn(`ATXPAccountHandler: failed to fetch payment request: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return params;
}
