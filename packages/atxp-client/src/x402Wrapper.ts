import type { Account, ProspectivePayment } from './types.js';
import { FetchLike, Logger, ConsoleLogger, Currency, Network } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

export interface X402Config {
  account: Account;
  approvePayment: (payment: ProspectivePayment) => Promise<boolean>;
  onPayment?: (args: { payment: ProspectivePayment }) => Promise<void>;
  onPaymentFailure?: (args: { payment: ProspectivePayment, error: Error }) => Promise<void>;
  logger?: Logger;
  maxRetries?: number;
}

interface X402PaymentChallenge {
  network: Network;
  currency: Currency;
  amount: string;
  recipient: string;
  memo?: string;
}

export function wrapWithX402(fetchFn: FetchLike, config: X402Config): FetchLike {
  const logger = config.logger ?? new ConsoleLogger();
  const maxRetries = config.maxRetries ?? 1;

  return async function x402FetchWrapper(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let attempt = 0;

    while (attempt <= maxRetries) {
      const response = await fetchFn(input, init);

      // Check if this is an X402 payment challenge
      if (response.status === 402 && response.headers.has('X-Payment')) {
        const paymentHeaderValue = response.headers.get('X-Payment');

        if (!paymentHeaderValue) {
          logger.warn('Received 402 response without X-Payment header');
          return response;
        }

        try {
          // Parse the X-Payment header to get payment details
          const paymentChallenge: X402PaymentChallenge = JSON.parse(paymentHeaderValue);

          const url = typeof input === 'string' ? input :
                     input instanceof URL ? input.href :
                     input instanceof Request ? input.url : '';

          // Find the appropriate payment maker for this network
          const paymentMakerKey = `${paymentChallenge.network}:${paymentChallenge.currency}`;
          const paymentMaker = config.account.paymentMakers[paymentMakerKey];

          if (!paymentMaker) {
            logger.error(`No payment maker found for ${paymentMakerKey}`);
            if (config.onPaymentFailure) {
              const payment: ProspectivePayment = {
                accountId: config.account.accountId,
                resourceUrl: url,
                resourceName: url,
                network: paymentChallenge.network,
                currency: paymentChallenge.currency,
                amount: new BigNumber(paymentChallenge.amount),
                iss: 'x402-server'
              };
              await config.onPaymentFailure({
                payment,
                error: new Error(`No payment maker for ${paymentMakerKey}`)
              });
            }
            return response;
          }

          // Create a prospective payment for approval
          const payment: ProspectivePayment = {
            accountId: config.account.accountId,
            resourceUrl: url,
            resourceName: url,
            network: paymentChallenge.network,
            currency: paymentChallenge.currency,
            amount: new BigNumber(paymentChallenge.amount),
            iss: 'x402-server'
          };

          // Check if the payment should be approved
          const approved = await config.approvePayment(payment);

          if (!approved) {
            logger.info('Payment not approved by user');
            if (config.onPaymentFailure) {
              await config.onPaymentFailure({
                payment,
                error: new Error('Payment not approved')
              });
            }
            return response;
          }

          logger.info(`Creating signed payment message for X402 challenge: ${paymentChallenge.amount} ${paymentChallenge.currency}`);

          // Create a signed payment message (but don't submit it to blockchain yet)
          const signedMessage = await paymentMaker.createSignedPaymentMessage(
            new BigNumber(paymentChallenge.amount),
            paymentChallenge.currency,
            paymentChallenge.recipient,
            paymentChallenge.memo || ''
          );

          // Retry the request with the X-Payment header containing the signed message
          const retryInit = {
            ...init,
            headers: {
              ...(init?.headers || {}),
              'X-Payment': JSON.stringify({
                signature: signedMessage.signature,
                data: signedMessage.data,
                from: signedMessage.from,
                to: signedMessage.to,
                amount: signedMessage.amount.toString(),
                currency: signedMessage.currency,
                network: signedMessage.network
              })
            }
          };

          logger.info('Retrying request with X-Payment header');
          const retryResponse = await fetchFn(input, retryInit);

          // If the payment was accepted, notify success
          if (retryResponse.ok) {
            if (config.onPayment) {
              await config.onPayment({ payment });
            }
            logger.info('X402 payment successful');
          } else if (config.onPaymentFailure) {
            await config.onPaymentFailure({
              payment,
              error: new Error(`Payment failed with status ${retryResponse.status}`)
            });
          }

          return retryResponse;
        } catch (error) {
          logger.error('Failed to handle X402 payment challenge:', error);

          // If we have a payment failure handler, call it
          if (config.onPaymentFailure) {
            const payment: ProspectivePayment = {
              accountId: config.account.accountId,
              resourceUrl: typeof input === 'string' ? input : '',
              resourceName: typeof input === 'string' ? input : '',
              network: 'base' as Network, // default
              currency: 'USDC' as Currency, // default
              amount: new BigNumber(0),
              iss: 'x402-server'
            };
            await config.onPaymentFailure({ payment, error: error as Error });
          }

          return response;
        }
      }

      // Not a 402 response, return as-is
      return response;
    }

    // Should never reach here, but return the last response just in case
    return await fetchFn(input, init);
  };
}

export function enableX402Support(config: X402Config): X402Config & { fetchFn: FetchLike } {
  const wrappedFetch = wrapWithX402(fetch as FetchLike, config);
  return {
    ...config,
    fetchFn: wrappedFetch
  };
}