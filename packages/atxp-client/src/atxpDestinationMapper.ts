import { FetchLike, Logger } from '@atxp/common';
import { DestinationMapper, Destination } from './destinationMapper.js';
import { Source } from '@atxp/common';



/**
 * Destination mapper for ATXP network destinations.
 * Converts destinations with network='atxp' to actual blockchain network destinations
 * by resolving the account ID to its associated blockchain addresses.
 */
export class ATXPDestinationMapper implements DestinationMapper {
  private accountsServiceUrl: string;
  private fetchFn: FetchLike;

  constructor(accountsServiceUrl: string, fetchFn: FetchLike = fetch) {
    this.accountsServiceUrl = accountsServiceUrl;
    this.fetchFn = fetchFn;
  }

  async mapDestinations(destinations: Destination[], logger?: Logger): Promise<Destination[]> {
    const mappedDestinations: Destination[] = [];

    for (const dest of destinations) {
      if (dest.network === 'atxp') {
        logger?.debug(`ATXPDestinationMapper: Mapping ATXP destination with address ${dest.address}`);

        try {
          // The address field contains the account ID (e.g., atxp_acct_xxx)
          const accountId = dest.address;
          const sources = await this.getAccountSources(accountId, logger);

          // Create new destinations for each blockchain address
          for (const src of sources) {
            const mappedDest: Destination = {
              chain: src.chain,
              currency: dest.currency,
              address: src.address,
              amount: dest.amount
            };
            mappedDestinations.push(mappedDest);
            logger?.debug(`ATXPDestinationMapper: Mapped to ${src.chain}:${src.chain}`);
          }

          if (sources.length === 0) {
            logger?.warn(`ATXPDestinationMapper: No addresses found for account ${accountId}`);
          } else {
            logger?.debug(`ATXPDestinationMapper: Found ${sources.length} sources for account ${accountId}`);
          }
        } catch (error) {
          logger?.error(`ATXPDestinationMapper: Failed to map ATXP destination: ${error}`);
          // If mapping fails, we don't include this destination
          // This allows other destinations to still be processed
        }
      } else {
        // Pass through non-ATXP destinations unchanged
        mappedDestinations.push(dest);
      }
    }

    return mappedDestinations;
  }

  private async getAccountSources(accountId: string, logger?: Logger): Promise<Source[]> {
    // Strip any network prefix if present (e.g., atxp:atxp_acct_xxx -> atxp_acct_xxx)
    const unqualifiedId = accountId.includes(':') ? accountId.split(':')[1] : accountId;

    const url = `${this.accountsServiceUrl}/account/${unqualifiedId}/sources`;
    logger?.debug(`ATXPDestinationMapper: Fetching addresses from ${url}`);

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
      logger?.debug(`ATXPDestinationMapper: Received ${data.length} addresses from API`);
      return data || [];
    } catch (error) {
      logger?.error(`ATXPDestinationMapper: Error fetching addresses: ${error}`);
      throw error;
    }
  }
}