import { FetchLike, Logger, Chain, Source, Currency, ChainEnum, CurrencyEnum, isEnumValue } from '@atxp/common';
import { Destination, PaymentRequestOption, DestinationMaker } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

// Type guard for destination response
type DestinationResponse = {
  chain: string;
  address: string;
  currency: string;
  amount: string;
};

type DestinationsApiResponse = {
  destinations: DestinationResponse[];
  paymentRequestId: string;
};

function isDestinationResponse(obj: unknown): obj is DestinationResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'chain' in obj &&
    'address' in obj &&
    'currency' in obj &&
    'amount' in obj &&
    typeof (obj as Record<string, unknown>).chain === 'string' &&
    typeof (obj as Record<string, unknown>).address === 'string' &&
    typeof (obj as Record<string, unknown>).currency === 'string' &&
    typeof (obj as Record<string, unknown>).amount === 'string'
  );
}

function isDestinationsApiResponse(obj: unknown): obj is DestinationsApiResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'destinations' in obj &&
    'paymentRequestId' in obj &&
    Array.isArray((obj as Record<string, unknown>).destinations) &&
    typeof (obj as Record<string, unknown>).paymentRequestId === 'string'
  );
}

function parseDestinationsResponse(data: unknown): Destination[] {
  // Validate response structure
  if (!isDestinationsApiResponse(data)) {
    throw new Error('Invalid response: expected object with destinations array and paymentRequestId');
  }

  // Validate and convert each destination
  return data.destinations.map((dest, index) => {
    if (!isDestinationResponse(dest)) {
      throw new Error(`Invalid destination at index ${index}: missing required fields (chain, address, currency, amount)`);
    }
    
    // Validate chain is a valid Chain enum value
    if (!isEnumValue(ChainEnum, dest.chain)) {
      const validChains = Object.values(ChainEnum).join(', ');
      throw new Error(`Invalid destination at index ${index}: chain "${dest.chain}" is not a valid chain. Valid chains are: ${validChains}`);
    }
    
    // Validate currency is a valid Currency enum value
    if (!isEnumValue(CurrencyEnum, dest.currency)) {
      const validCurrencies = Object.values(CurrencyEnum).join(', ');
      throw new Error(`Invalid destination at index ${index}: currency "${dest.currency}" is not a valid currency. Valid currencies are: ${validCurrencies}`);
    }
    
    // Validate amount is a valid number
    const amount = new BigNumber(dest.amount);
    if (amount.isNaN()) {
      throw new Error(`Invalid destination at index ${index}: amount "${dest.amount}" is not a valid number`);
    }
    
    return {
      chain: dest.chain as Chain,
      currency: dest.currency as Currency,
      address: dest.address,
      amount: amount
    };
  });
}

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

  async makeDestinations(option: PaymentRequestOption, logger: Logger, paymentRequestId: string, sources: Source[]): Promise<Destination[]> {
    if (option.network !== 'atxp') {
      return [];
    }

    try {
      // The address field contains the account ID (e.g., atxp_acct_xxx) for atxp options
      const accountId = option.address;

      // Always use the destinations endpoint
      const destinations = await this.getDestinations(accountId, paymentRequestId, option, sources, logger);

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

  private async getDestinations(accountId: string, paymentRequestId: string, option: PaymentRequestOption, sources: Source[], logger?: Logger): Promise<Destination[]> {
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
        }],
        sources: sources
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

      const data = await response.json();
      
      return parseDestinationsResponse(data);
    } catch (error) {
      logger?.error(`ATXPDestinationMaker: Error fetching destinations: ${error}`);
      throw error;
    }
  }
}