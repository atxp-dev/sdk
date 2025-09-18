import type { Account, X402Message } from './types.js';
import { FetchLike, Logger, ConsoleLogger } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

export function wrapWithX402(fetchFn: FetchLike, account: Account, logger?: Logger): FetchLike {
  const log = logger ?? new ConsoleLogger();
  return async function x402FetchWrapper(input: string | URL, init?: RequestInit): Promise<Response> {
    const response = await fetchFn(input, init);

    // Check if this is an X402 payment challenge
    if (response.status === 402) {
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

        // Find the accept option for base:USDC
        const baseUsdcOption = paymentChallenge.accepts.find((option: any) =>
          option.network === 'base' && option.asset === '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
        );

        if (!baseUsdcOption) {
          log.error('No base:USDC accept option found in payment challenge');
          throw new Error('No base:USDC accept option found in payment challenge');
        }

        const { network, maxAmountRequired, payTo: recipient, asset } = baseUsdcOption;

        // Convert maxAmountRequired from wei to decimal (USDC has 6 decimals)
        const amount = new BigNumber(maxAmountRequired).dividedBy(new BigNumber(10).pow(6)).toString();
        const currency = 'USDC'; // Based on the asset address in the response

        log.debug(`Payment required: ${amount} ${currency} on ${network} to ${recipient}`);

        // Find the appropriate payment maker using just the network name
        const paymentMaker = account.paymentMakers[network];

        if (!paymentMaker) {
          log.info(`No payment maker found for ${network}`);
          return response;
        }

        log.debug(`Creating EIP-3009 payment authorization`);

        // Create an EIP-3009 payment authorization
        const eip3009Authorization = await paymentMaker.createPaymentAuthorization(
          new BigNumber(amount),
          currency,
          recipient,
          ''
        );

        // Wrap the EIP-3009 authorization in X402 protocol format
        const x402Message: X402Message = {
          x402Version: 1,
          scheme: 'exact',
          network: network,
          payload: eip3009Authorization
        };

        // Base64 encode the X402 message for the X-Payment header
        const x402MessageJson = JSON.stringify(x402Message);
        log.debug(`X402 message being sent: ${x402MessageJson}`);
        const x402MessageBase64 = typeof Buffer !== 'undefined'
          ? Buffer.from(x402MessageJson).toString('base64')
          : btoa(x402MessageJson);

        // Send the X402 message in the X-Payment header
        const retryInit = {
          ...init,
          headers: {
            ...(init?.headers || {}),
            'X-Payment': x402MessageBase64
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