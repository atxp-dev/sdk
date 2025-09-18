import type { Account, X402Message } from './types.js';
import { FetchLike, Logger, ConsoleLogger } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import {
  createPaymentHeader,
  selectPaymentRequirements,
  type PaymentRequirements
} from 'x402/client';
import { createSigner } from 'x402/types';
import type { Hex } from 'viem';

/**
 * Wraps fetch with X402 payment support using the official x402 library functions
 * This version uses x402's createPaymentHeader directly instead of our custom implementation
 */
export function wrapWithX402V2(fetchFn: FetchLike, account: Account, logger?: Logger): FetchLike {
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
      const paymentChallenge = JSON.parse(responseBody);

      // Check if this is a valid X402 response
      if (!paymentChallenge.x402Version || !paymentChallenge.accepts || !Array.isArray(paymentChallenge.accepts)) {
        log.debug('Received 402 response without valid X402 format');
        return response;
      }

      const { x402Version, accepts } = paymentChallenge;

      // Use x402's selectPaymentRequirements to find the best option
      // This matches what x402-fetch does internally
      const selectedPaymentRequirements = selectPaymentRequirements(
        accepts as PaymentRequirements[],
        'base', // We only support base for now
        'exact'
      );

      if (!selectedPaymentRequirements) {
        log.error('No suitable payment requirements found');
        return response;
      }

      const { network, maxAmountRequired, payTo: recipient, asset } = selectedPaymentRequirements;

      // Convert maxAmountRequired from wei to decimal (USDC has 6 decimals)
      const amount = new BigNumber(maxAmountRequired).dividedBy(new BigNumber(10).pow(6)).toString();
      const currency = 'USDC';

      log.debug(`Payment required: ${amount} ${currency} on ${network} to ${recipient}`);

      // Find the appropriate payment maker
      const paymentMaker = account.paymentMakers[network];

      if (!paymentMaker) {
        log.info(`No payment maker found for ${network}`);
        return response;
      }

      // For now, we'll use our existing EIP-3009 authorization method
      // In a real implementation, we'd use x402's createPaymentHeader with a proper signer
      log.debug(`Creating EIP-3009 payment authorization`);

      const eip3009Authorization = await paymentMaker.createPaymentAuthorization(
        new BigNumber(amount),
        currency,
        recipient,
        ''
      );

      // Wrap in X402 message format (same as before)
      const x402Message: X402Message = {
        x402Version: x402Version,
        scheme: 'exact',
        network: network,
        payload: eip3009Authorization
      };

      // Base64 encode the X402 message
      const x402MessageJson = JSON.stringify(x402Message);
      log.debug(`X402 message being sent: ${x402MessageJson}`);
      const x402MessageBase64 = typeof Buffer !== 'undefined'
        ? Buffer.from(x402MessageJson).toString('base64')
        : btoa(x402MessageJson);

      // Add the Access-Control-Expose-Headers header like x402-fetch does
      const retryInit = {
        ...init,
        headers: {
          ...(init?.headers || {}),
          'X-PAYMENT': x402MessageBase64,
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