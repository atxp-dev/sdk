import type { Account } from './types.js';
import { FetchLike, Logger, ConsoleLogger } from '@atxp/common';
import { createPaymentHeader, selectPaymentRequirements } from 'x402/client';
import { createSigner, type Signer } from 'x402/types';
import type { Hex } from 'viem';

/**
 * Wraps fetch with X402 payment support using the official x402 library
 * This version directly uses x402's createPaymentHeader function like x402-fetch does
 *
 * Note: This requires the account to have a private key available for creating
 * the x402 Signer object. For remote signing, use the RemoteSigner approach instead.
 */
export function wrapWithX402UsingLibrary(
  fetchFn: FetchLike,
  privateKey: Hex,
  logger?: Logger
): FetchLike {
  const log = logger ?? new ConsoleLogger();

  return async function x402FetchWrapper(input: string | URL, init?: RequestInit): Promise<Response> {
    const response = await fetchFn(input, init);

    // Check if this is an X402 payment challenge
    if (response.status !== 402) {
      return response;
    }

    log.info('Received X402 payment challenge');

    try {
      // Parse the X402 payment requirements from response body
      const responseBody = await response.text();
      const { x402Version, accepts } = JSON.parse(responseBody);

      // Check if this is a valid X402 response
      if (!x402Version || !accepts || !Array.isArray(accepts)) {
        log.debug('Received 402 response without valid X402 format');
        return response;
      }

      // Use x402's selectPaymentRequirements to find the best option
      const selectedPaymentRequirements = selectPaymentRequirements(
        accepts,
        'base',
        'exact'
      );

      if (!selectedPaymentRequirements) {
        log.error('No suitable payment requirements found');
        return response;
      }

      const { network, maxAmountRequired, payTo } = selectedPaymentRequirements;

      // Convert amount from wei to human-readable for logging
      const amountInUsdc = Number(maxAmountRequired) / (10 ** 6);
      log.debug(`Payment required: ${amountInUsdc} USDC on ${network} to ${payTo}`);

      // Create an x402 signer for the network
      const signer = await createSigner(network, privateKey);

      // Use x402's createPaymentHeader directly - this is the key difference!
      // This function handles all the EIP-3009 signing internally
      log.debug(`Creating payment header using x402 library`);
      const paymentHeader = await createPaymentHeader(
        signer,
        x402Version,
        selectedPaymentRequirements
      );

      // Add headers exactly like x402-fetch does
      const retryInit = {
        ...init,
        headers: {
          ...(init?.headers || {}),
          'X-PAYMENT': paymentHeader,
          'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE'
        }
      };

      log.info('Retrying request with X-Payment header');

      // Retry the request
      const retryResponse = await fetchFn(input, retryInit);

      if (retryResponse.ok) {
        log.info('X402 payment accepted, request successful');
      } else {
        log.warn(`Request failed after payment with status ${retryResponse.status}`);
      }

      return retryResponse;
    } catch (error) {
      // If there's an error processing the payment, return the original 402 response
      log.error(`Failed to handle X402 payment challenge: ${error}`);
      return response;
    }
  };
}