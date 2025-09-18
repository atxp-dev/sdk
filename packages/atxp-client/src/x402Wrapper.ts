import type { Account, X402Message } from './types.js';
import { FetchLike, Logger, ConsoleLogger } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

export function wrapWithX402(fetchFn: FetchLike, account: Account, logger?: Logger): FetchLike {
  const log = logger ?? new ConsoleLogger();
  return async function x402FetchWrapper(input: string | URL, init?: RequestInit): Promise<Response> {
    const response = await fetchFn(input, init);

    // Check if this is an X402 payment challenge
    if (response.status === 402) {
      const paymentHeader = response.headers.get('X-Payment-Required');

      if (!paymentHeader) {
        // Not an X402 response, return as-is
        log.debug('Received 402 response without X-Payment-Required header');
        return response;
      }

      log.info('Received X402 payment challenge');

      try {
        // Parse the X402 payment requirements
        const paymentChallenge = JSON.parse(paymentHeader);
        const { network, currency, amount, recipient, memo } = paymentChallenge;

        log.debug(`Payment required: ${amount} ${currency} on ${network} to ${recipient}`);

        // Find the appropriate payment maker
        const paymentMakerKey = `${network}:${currency}`;
        const paymentMaker = account.paymentMakers[paymentMakerKey];

        if (!paymentMaker) {
          log.error(`No payment maker found for ${paymentMakerKey}`);
          throw new Error(`No payment maker found for ${paymentMakerKey}`);
        }

        log.debug(`Creating EIP-3009 payment authorization`);

        // Create an EIP-3009 payment authorization
        const eip3009Authorization = await paymentMaker.createPaymentAuthorization(
          new BigNumber(amount),
          currency,
          recipient,
          memo || ''
        );

        // Wrap the EIP-3009 authorization in X402 protocol format
        const x402Message: X402Message = {
          x402Version: 1,
          scheme: 'exact',
          network: network,
          payload: eip3009Authorization
        };

        // Send the X402 message in the X-Payment header
        const retryInit = {
          ...init,
          headers: {
            ...(init?.headers || {}),
            'X-Payment': JSON.stringify(x402Message)
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
    }

    // Not a 402 response, return as-is
    return response;
  };
}