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
  destination(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress>;
  // New method for getting multiple destinations
  destinations?(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress[]>;
}

export class ChainPaymentDestination implements PaymentDestination {
  constructor(
    private readonly address: string,
    private readonly network: Network
  ) {}

  async destination(_fundingAmount: FundingAmount, _buyerAddress: string): Promise<PaymentAddress> {
    return {
      destination: this.address,
      network: this.network
    };
  }

  async destinations(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress[]> {
    // Return single destination as array for backwards compatibility
    const dest = await this.destination(fundingAmount, buyerAddress);
    return [dest];
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

  async destination(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress> {
    this.logger.debug(`Getting payment destination for buyer: ${buyerAddress}, amount: ${fundingAmount.amount.toString()} ${fundingAmount.currency}`);

    const url = new URL(`${this.accountServerURL}/destination`);
    url.searchParams.set('connectionToken', this.token);
    url.searchParams.set('buyerAddress', buyerAddress);
    url.searchParams.set('amount', fundingAmount.amount.toString());

    this.logger.debug(`Making request to: ${url.toString()}`);

    const response = await this.fetchFn(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`/destination failed: ${response.status} ${response.statusText} ${text}`);
      throw new Error(`ATXPPaymentDestination: /destination failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as { destination?: string; chainType?: string };
    if (!json?.destination) {
      this.logger.error('/destination did not return destination');
      throw new Error('ATXPPaymentDestination: /destination did not return destination');
    }
    if (!json?.chainType) {
      this.logger.error('/destination did not return chainType');
      throw new Error('ATXPPaymentDestination: /destination did not return chainType');
    }

    // Map chainType to expected network values
    // The accounts service returns 'ethereum' for Base wallets, but the payment system expects 'base'
    let network: Network;
    switch (json.chainType) {
      case 'ethereum':
        network = 'base'; // Base is an Ethereum L2
        break;
      case 'base':
        network = 'base'; // Already correct
        break;
      case 'solana':
        network = 'solana';
        break;
      default:
        this.logger.warn(`Unknown chainType: ${json.chainType}, defaulting to base`);
        network = 'base';
    }

    this.logger.debug(`Successfully got payment destination: ${json.destination} on ${network} (chainType: ${json.chainType})`);
    return {
      destination: json.destination,
      network
    };
  }

  async destinations(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress[]> {
    this.logger.debug(`Getting payment destinations for buyer: ${buyerAddress}, amount: ${fundingAmount.amount.toString()} ${fundingAmount.currency}`);

    const url = new URL(`${this.accountServerURL}/addresses`);

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

    const json = await response.json() as Array<{ destination?: string; chainType?: string }>;
    if (!Array.isArray(json) || json.length === 0) {
      this.logger.error('/addresses did not return any destinations');
      throw new Error('ATXPPaymentDestination: /addresses did not return any destinations');
    }

    const addresses: PaymentAddress[] = [];
    for (const item of json) {
      if (!item?.destination || !item?.chainType) {
        this.logger.warn('Skipping invalid address entry');
        continue;
      }

      // Map chainType to expected network values
      let network: Network;
      switch (item.chainType) {
        case 'ethereum':
          network = 'base'; // Base is an Ethereum L2
          break;
        case 'base':
          network = 'base'; // Already correct
          break;
        case 'solana':
          network = 'solana';
          break;
        default:
          this.logger.warn(`Unknown chainType: ${item.chainType}, skipping`);
          continue;
      }

      addresses.push({
        destination: item.destination,
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