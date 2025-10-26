import { FetchLike, Logger, Chain } from '@atxp/common';
import { Source, Destination, PaymentRequestOption, DestinationMaker } from '@atxp/common';

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
    const mappedDestinations: Destination[] = [];

    if (option.network !== 'atxp') {
      return [];
    }

    try {
      // The address field contains the account ID (e.g., atxp_acct_xxx) for atxp options
      const accountId = option.address;

      // If we have a paymentRequestId, use the new destination endpoint
      // This will create Stripe payment intents for Base network when available
      if (paymentRequestId) {
        const destination = await this.getDestination(accountId, paymentRequestId, option, logger);
        if (destination) {
          mappedDestinations.push(destination);
          logger.debug(`ATXPDestinationMaker: Got destination from /destination endpoint for account ${accountId}`);
          return mappedDestinations;
        }
      }

      // Fallback to sources endpoint if no paymentRequestId or destination endpoint fails
      const sources = await this.getAccountSources(accountId, logger);

      // Create new destinations for each blockchain address
      // But don't include smart wallets - we'll only make payments to EOA wallets
      for (const src of sources.filter(s => s.walletType === 'eoa')) {
        const mappedDest: Destination = {
          chain: src.chain,
          currency: option.currency,
          address: src.address,
          amount: option.amount
        };
        mappedDestinations.push(mappedDest);
      }

      if (sources.length === 0) {
        logger.warn(`ATXPDestinationMaker: No sources found for account ${accountId}`);
      } else {
        logger.debug(`ATXPDestinationMaker: Found ${sources.length} sources for account ${accountId}`);
      }
    } catch (error) {
      logger.error(`ATXPDestinationMaker: Failed to make ATXP destinations: ${error}`);
      throw error;
    }

    return mappedDestinations;
  }

  private async getDestination(accountId: string, paymentRequestId: string, option: PaymentRequestOption, logger?: Logger): Promise<Destination | null> {
    // Strip any network prefix if present
    const unqualifiedId = accountId.includes(':') ? accountId.split(':')[1] : accountId;

    const url = `${this.accountsServiceUrl}/account/${unqualifiedId}/destination/${paymentRequestId}`;
    logger?.debug(`ATXPDestinationMaker: Fetching destination from ${url}`);

    try {
      // Determine the network to request based on the chain
      // For ATXP network, we typically want to use 'base' as the underlying network
      const requestBody = {
        network: 'base', // Default to Base network for ATXP destinations
        currency: option.currency.toString(),
        amount: option.amount.toString()
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
        logger?.warn(`ATXPDestinationMaker: Failed to fetch destination: ${response.status} ${response.statusText} - ${text}`);
        return null;
      }

      const data = await response.json() as {
        network: string;
        address: string;
        currency: string;
        paymentMethod: string;
        paymentRequestId: string;
        paymentIntentId?: string;
      };

      // Convert the response to a Destination
      const destination: Destination = {
        chain: data.network as Chain, // Will be 'base' or other supported chain
        currency: option.currency,
        address: data.address,
        amount: option.amount
      };

      logger?.debug(`ATXPDestinationMaker: Got ${data.paymentMethod} destination for ${data.network}`);
      return destination;
    } catch (error) {
      logger?.error(`ATXPDestinationMaker: Error fetching destination: ${error}`);
      return null;
    }
  }

  private async getAccountSources(accountId: string, logger?: Logger): Promise<Source[]> {
    // Strip any network prefix if present (e.g., atxp:atxp_acct_xxx -> atxp_acct_xxx)
    const unqualifiedId = accountId.includes(':') ? accountId.split(':')[1] : accountId;

    const url = `${this.accountsServiceUrl}/account/${unqualifiedId}/sources`;
    logger?.debug(`ATXPDestinationMaker: Fetching addresses from ${url}`);

    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch addresses: ${response.status} ${response.statusText} - ${text}`);
      }

      const data = await response.json() as Source[];
      return data || [];
    } catch (error) {
      logger?.error(`ATXPDestinationMaker: Error fetching addresses: ${error}`);
      throw error;
    }
  }
}

