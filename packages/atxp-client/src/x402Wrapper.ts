import type { Account } from './types.js';
import { FetchLike } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

export function wrapWithX402(fetchFn: FetchLike, account: Account): FetchLike {
  return async function x402FetchWrapper(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await fetchFn(input, init);

    // Check if this is an X402 payment challenge
    if (response.status === 402) {
      const paymentHeader = response.headers.get('X-Payment-Required');

      if (!paymentHeader) {
        // Not an X402 response, return as-is
        return response;
      }

      try {
        // Parse the X402 payment requirements
        const paymentChallenge = JSON.parse(paymentHeader);
        const { network, currency, amount, recipient, memo } = paymentChallenge;

        // Find the appropriate payment maker
        const paymentMakerKey = `${network}:${currency}`;
        const paymentMaker = account.paymentMakers[paymentMakerKey];

        if (!paymentMaker) {
          throw new Error(`No payment maker found for ${paymentMakerKey}`);
        }

        // Create an EIP-3009 payment authorization for X402
        const authorization = await paymentMaker.createPaymentAuthorization(
          new BigNumber(amount),
          currency,
          recipient,
          memo || ''
        );

        // The authorization is already in X402 format with EIP-3009 payload
        // Send it directly in the X-Payment header
        const retryInit = {
          ...init,
          headers: {
            ...(init?.headers || {}),
            'X-Payment': JSON.stringify(authorization)
          }
        };

        // Retry the request
        return await fetchFn(input, retryInit);
      } catch (error) {
        // If there's an error processing the payment, return the original 402 response
        console.error('Failed to handle X402 payment challenge:', error);
        return response;
      }
    }

    // Not a 402 response, return as-is
    return response;
  };
}