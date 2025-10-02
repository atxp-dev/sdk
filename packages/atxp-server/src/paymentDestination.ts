import { Currency, Network, FetchLike, UrlString, Logger, ConsoleLogger } from "@atxp/common";
import BigNumber from "bignumber.js";

export type FundingAmount = {
  amount: BigNumber;
  currency: Currency;
}

export type PaymentAddress = {
  destination: string;
  network: Network;
}

export interface PaymentDestination {
  destinations(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress[]>;
}

export class ChainPaymentDestination implements PaymentDestination {
  constructor(
    private readonly address: string,
    private readonly network: Network
  ) {}

  async destinations(_fundingAmount: FundingAmount, _buyerAddress: string): Promise<PaymentAddress[]> {
    return [{
      destination: this.address,
      network: this.network
    }];
  }
}

function parseConnectionString(connectionString: string): { origin: UrlString; token: string } {
  const url = new URL(connectionString);
  const origin = url.origin as UrlString;
  const token = url.searchParams.get('connection_token') || '';
  if (!token) {
    throw new Error('ATXPPaymentDestination: connection string missing connection token');
  }
  return { origin, token };
}

export class ATXPPaymentDestination implements PaymentDestination {
  private accountServerURL: UrlString;
  private token: string;
  private fetchFn: FetchLike;
  private logger: Logger;

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; logger?: Logger }) {
    const { origin, token } = parseConnectionString(connectionString);
    this.accountServerURL = origin;
    this.token = token;
    this.fetchFn = opts?.fetchFn ?? fetch.bind(globalThis);
    this.logger = opts?.logger ?? new ConsoleLogger({ prefix: '[atxp-payment-destination]' });
  }

  async destinations(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress[]> {
    this.logger.debug(`Getting payment destinations for buyer: ${buyerAddress}, amount: ${fundingAmount.amount.toString()} ${fundingAmount.currency}`);

    const url = new URL(`${this.accountServerURL}/addresses?buyerAddress=${buyerAddress}&amount=${fundingAmount.amount.toString()}`);

    // Add currency parameter if provided
    if (fundingAmount.currency) {
      url.searchParams.set('currency', fundingAmount.currency);
    }

    // Use Basic auth with the token, like ATXPLocalAccount does
    const authHeader = `Basic ${Buffer.from(`${this.token}:`).toString('base64')}`;

    this.logger.debug(`Making request to: ${url.toString()}`);

    const response = await this.fetchFn(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`/addresses failed: ${response.status} ${response.statusText} ${text}`);
      throw new Error(`ATXPPaymentDestination: /addresses failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as Array<{ address?: string; network?: string; currency?: string }>;
    if (!Array.isArray(json) || json.length === 0) {
      this.logger.error('/addresses did not return any addresses');
      throw new Error('ATXPPaymentDestination: /addresses did not return any addresses');
    }

    const addresses: PaymentAddress[] = [];
    for (const item of json) {
      const networkFromItem = item?.network;
      if (!item?.address || !networkFromItem) {
        this.logger.warn('Skipping invalid address entry');
        continue;
      }

      // Map network values if needed
      let network: Network;
      switch (networkFromItem) {
        case 'ethereum':
          network = 'base'; // Base is an Ethereum L2
          break;
        case 'base':
        case 'base_sepolia':
        case 'world':
        case 'world_sepolia':
        case 'solana':
          network = networkFromItem
          break;
        default:
          this.logger.warn(`Unknown network: ${networkFromItem}, skipping`);
          continue;
      }

      addresses.push({
        destination: item.address,
        network
      });
    }

    if (addresses.length === 0) {
      throw new Error('ATXPPaymentDestination: no valid addresses returned');
    }

    this.logger.debug(`Successfully got ${addresses.length} payment destinations`);
    return addresses;
  }
}