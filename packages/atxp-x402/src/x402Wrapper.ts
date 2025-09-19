import { ProspectivePayment, FetchWrapper, ClientArgs } from '@atxp/client';
import { FetchLike, Network } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { createPaymentHeader, selectPaymentRequirements } from 'x402/client';
import { LocalAccount } from 'viem';

// Type guard for X402 challenge
interface X402Challenge {
  x402Version?: unknown;
  accepts?: unknown;
}

function isX402Challenge(obj: unknown): obj is X402Challenge {
  return typeof obj === 'object' && obj !== null;
}

/**
 * Creates an X402 payment wrapper for fetch.
 * This wrapper intercepts 402 responses and creates payments using the x402 library.
 * It follows the standard wrapper pattern - taking ClientConfig and returning a wrapped fetch.
 *
 * @param config - ClientArgs containing account, logger, and fetch function
 * @returns A wrapped fetch function that handles X402 payments
 */
export const wrapWithX402: FetchWrapper = (config: ClientArgs): FetchLike => {
  const { account, logger, fetchFn = fetch, approvePayment, onPayment, onPaymentFailure } = config;
  const log = logger ?? console;

  // Check if account has getSigner method
  const accountWithSigner = account as { getSigner?: () => Promise<LocalAccount> };
  if (!accountWithSigner.getSigner) {
    throw new Error('Account does not support getSigner, X402 payments will not work');
  }

  // Use arrow function to preserve context, matching atxpFetcher pattern
  const x402FetchWrapper: FetchLike = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetchFn(input, init);

    // Check if this is an X402 payment challenge
    if (response.status !== 402) {
      return response;
    }

    log.info('Received X402 payment challenge');

    // Parse the X402 payment requirements from response body
    const responseBody = await response.text();
    let paymentChallenge: unknown;

    try {
      paymentChallenge = JSON.parse(responseBody);
    } catch (parseError) {
      log.error(`Failed to parse X402 challenge: ${parseError}`);
      // Return a new Response with the original body since we consumed it
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }

    try {

      // Check if this is a valid X402 response
      if (!isX402Challenge(paymentChallenge) ||
          !paymentChallenge.x402Version ||
          !paymentChallenge.accepts ||
          !Array.isArray(paymentChallenge.accepts)) {
        log.debug('Received 402 response without valid X402 format');
        // Return a new Response with the original body since we consumed it
        return new Response(responseBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }

      // Select the best payment requirements (prefer base network, exact scheme)
      const selectedPaymentRequirements = selectPaymentRequirements(
        paymentChallenge.accepts,
        'base',
        'exact'
      );

      if (!selectedPaymentRequirements) {
        log.info('No suitable X402 payment option found');
        return new Response(responseBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }

      // Convert amount from wei to human-readable for logging and approval
      const amountInUsdc = Number(selectedPaymentRequirements.maxAmountRequired) / (10 ** 6);
      log.debug(`Payment required: ${amountInUsdc} USDC on ${selectedPaymentRequirements.network} to ${selectedPaymentRequirements.payTo}`);

      // Create the ProspectivePayment object for callbacks
      const url = typeof input === 'string' ? input : input.toString();
      const prospectivePayment: ProspectivePayment = {
        accountId: account.accountId,
        resourceUrl: url,
        resourceName: selectedPaymentRequirements.description || url,
        network: selectedPaymentRequirements.network as Network,
        currency: 'USDC',
        amount: new BigNumber(amountInUsdc),
        iss: selectedPaymentRequirements.payTo
      };

      // Check if payment should be approved
      if (approvePayment) {
        const approved = await approvePayment(prospectivePayment);

        if (!approved) {
          log.info('Payment not approved by user');
          if (onPaymentFailure) {
            await onPaymentFailure({
              payment: prospectivePayment,
              error: new Error('Payment not approved')
            });
          }
          return new Response(responseBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      }

      // Get the signer from the account
      log.debug('Getting signer from account');
      const signer: LocalAccount = await accountWithSigner.getSigner!();

      // Create the X402 payment header using the x402 library
      log.debug('Creating X402 payment header with signer');
      const paymentHeader = await createPaymentHeader(
        signer,
        paymentChallenge.x402Version as number,
        selectedPaymentRequirements
      );

      // Add the payment header and retry the request, preserving ALL original headers
      // This is crucial to maintain Accept and other headers
      const originalHeaders = init?.headers;
      let retryHeaders: Headers;

      // Always use Headers object to ensure proper header handling
      if (originalHeaders instanceof Headers) {
        // Clone the Headers object
        retryHeaders = new Headers(originalHeaders);
      } else if (originalHeaders) {
        // Convert plain object to Headers
        retryHeaders = new Headers(originalHeaders as HeadersInit);
      } else {
        // Start with empty headers
        retryHeaders = new Headers();
      }

      // Add payment headers
      retryHeaders.set('X-PAYMENT', paymentHeader);
      retryHeaders.set('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE');

      // Create new init object with preserved headers
      const retryInit: RequestInit = {
        ...init,
        headers: retryHeaders
      };

      log.info('Retrying request with X-PAYMENT header');
      log.debug(`Retry headers: X-PAYMENT=${paymentHeader.substring(0, 20)}...`);
      const retryResponse = await fetchFn(input, retryInit);

      if (retryResponse.ok) {
        log.info('X402 payment accepted, request successful');

        // Call onPayment callback if provided
        if (onPayment) {
          await onPayment({ payment: prospectivePayment });
        }
      } else {
        log.warn(`Request failed after payment with status ${retryResponse.status}`);

        if (onPaymentFailure) {
          await onPaymentFailure({
            payment: prospectivePayment,
            error: new Error(`Request failed with status ${retryResponse.status}`)
          });
        }
      }

      return retryResponse;
    } catch (error) {
      // If there's an error processing the payment, call failure callback and return original response
      log.error(`Failed to handle X402 payment challenge: ${error}`);

      if (onPaymentFailure && isX402Challenge(paymentChallenge) && paymentChallenge.accepts && Array.isArray(paymentChallenge.accepts) && paymentChallenge.accepts[0]) {
        const firstOption = paymentChallenge.accepts[0] as { maxAmountRequired?: string | number; description?: string; network?: string; payTo?: string };
        const amount = firstOption.maxAmountRequired ? Number(firstOption.maxAmountRequired) / (10 ** 6) : 0;
        const url = typeof input === 'string' ? input : input.toString();
        await onPaymentFailure({
          payment: {
            accountId: account.accountId,
            resourceUrl: url,
            resourceName: firstOption.description || url,
            network: (firstOption.network || 'base') as Network,
            currency: 'USDC',
            amount: new BigNumber(amount),
            iss: firstOption.payTo || ''
          },
          error: error as Error
        });
      }

      // Return a new Response with the original body since we consumed it
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }
  };

  return x402FetchWrapper;
};
