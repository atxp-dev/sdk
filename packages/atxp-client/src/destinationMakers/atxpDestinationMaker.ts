import { FetchLike, Logger } from '@atxp/common';
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

  async makeDestinations(option: PaymentRequestOption, logger: Logger): Promise<Destination[]> {
    const mappedDestinations: Destination[] = [];

    if (option.network !== 'atxp') {
      return [];
    }

    try {
      // The address field contains the account ID (e.g., atxp_acct_xxx) for atxp options
      const accountId = option.address;
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

