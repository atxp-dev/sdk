import { ClientConfig, ProspectivePayment, FetchWrapper } from '@atxp/client';
import { FetchLike, Network } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { createPaymentHeader, selectPaymentRequirements } from 'x402/client';
import { LocalAccount } from 'viem';

/**
 * Creates an X402 payment wrapper for fetch.
 * This wrapper intercepts 402 responses and creates payments using the x402 library.
 * It follows the standard wrapper pattern - taking ClientConfig and returning a wrapped fetch.
 *
 * @param config - ClientConfig containing account, logger, and fetch function
 * @returns A wrapped fetch function that handles X402 payments
 */
export const wrapWithX402: FetchWrapper = (config: ClientConfig): FetchLike => {
  const { account, logger, fetchFn = fetch, approvePayment, onPayment, onPaymentFailure } = config;
  const log = logger ?? console;

  // Check if account has getSigner method
  const accountWithSigner = account as { getSigner?: () => Promise<LocalAccount> };
  if (!accountWithSigner.getSigner) {
    throw new Error('Account does not support getSigner, X402 payments will not work');
  }

  return async function x402FetchWrapper(input: string | URL, init?: RequestInit): Promise<Response> {
    const response = await fetchFn(input, init);

    // Check if this is an X402 payment challenge
    if (response.status !== 402) {
      return response;
    }

    log.info('Received X402 payment challenge');

    // Parse the X402 payment requirements from response body
    const responseBody = await response.text();
    let paymentChallenge: any;

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
      if (!paymentChallenge.x402Version || !paymentChallenge.accepts || !Array.isArray(paymentChallenge.accepts)) {
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
        paymentChallenge.x402Version,
        selectedPaymentRequirements
      );

      // Add the payment header and retry the request
      const retryInit = {
        ...init,
        headers: {
          ...(init?.headers || {}),
          'X-PAYMENT': paymentHeader,
          // Request the payment response header
          'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE'
        }
      };

      log.info('Retrying request with X-PAYMENT header');
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

      if (onPaymentFailure && paymentChallenge?.accepts?.[0]) {
        const firstOption = paymentChallenge.accepts[0];
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
};
