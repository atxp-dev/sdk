import { FetchLike, Logger, Chain } from '@atxp/common';
import { Destination, PaymentRequestOption, DestinationMaker } from '@atxp/common';

/**
 * Destination mapper for ATXP network destinations.
 * Converts destinations with network='atxp' to actual blockchain network destinations
 * by resolving the account ID to its associated blockchain addresses.
 */
export class ATXPDestinationMaker implements DestinationMaker {
  private accountsServiceUrl: string;
  private fetchFn: FetchLike;

  constructor(accountsServiceUrl: string, fetchFn: FetchLike = fetch) {
    this.accountsServiceUrl = accountsServiceUrl;
    this.fetchFn = fetchFn;
  }

  async makeDestinations(option: PaymentRequestOption, logger: Logger, paymentRequestId: string): Promise<Destination[]> {
    if (option.network !== 'atxp') {
      return [];
    }

    try {
      // The address field contains the account ID (e.g., atxp_acct_xxx) for atxp options
      const accountId = option.address;

      // Always use the destinations endpoint
      const destinations = await this.getDestinations(accountId, paymentRequestId, option, logger);

      if (destinations.length === 0) {
        logger.warn(`ATXPDestinationMaker: No destinations found for account ${accountId}`);
      } else {
        logger.debug(`ATXPDestinationMaker: Got ${destinations.length} destinations for account ${accountId}`);
      }

      return destinations;
    } catch (error) {
      logger.error(`ATXPDestinationMaker: Failed to make ATXP destinations: ${error}`);
      throw error;
    }
  }

  private async getDestinations(accountId: string, paymentRequestId: string, option: PaymentRequestOption, logger?: Logger): Promise<Destination[]> {
    // Strip any network prefix if present
    const unqualifiedId = accountId.includes(':') ? accountId.split(':')[1] : accountId;

    const url = `${this.accountsServiceUrl}/account/${unqualifiedId}/destinations`;
    logger?.debug(`ATXPDestinationMaker: Fetching destinations from ${url}`);

    try {
      const requestBody = {
        paymentRequestId,
        options: [{
          network: option.network,
          currency: option.currency.toString(),
          address: option.address,
          amount: option.amount.toString()
        }]
      };

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch destinations: ${response.status} ${response.statusText} - ${text}`);
      }

      const data = await response.json() as {
        destinations: Array<{
          network: string;
          address: string;
          currency: string;
          amount: string;
          paymentMethod?: string;
        }>;
        paymentRequestId: string;
      };

      // Convert the response destinations to Destination objects
      return data.destinations.map(dest => ({
        chain: dest.network as Chain,
        currency: option.currency,
        address: dest.address,
        amount: option.amount
      }));
    } catch (error) {
      logger?.error(`ATXPDestinationMaker: Error fetching destinations: ${error}`);
      throw error;
    }
  }
}