import { Currency, Network, FetchLike, UrlString } from "@atxp/common";
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

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike }) {
    const { origin, token } = parseConnectionString(connectionString);
    this.accountServerURL = origin;
    this.token = token;
    this.fetchFn = opts?.fetchFn ?? fetch;
  }

  async destination(fundingAmount: FundingAmount, buyerAddress: string): Promise<PaymentAddress> {
    const url = new URL(`${this.accountServerURL}/destination`);
    url.searchParams.set('connectionToken', this.token);
    url.searchParams.set('buyerAddress', buyerAddress);
    url.searchParams.set('amount', fundingAmount.amount.toString());

    const response = await this.fetchFn(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPPaymentDestination: /destination failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as { destination?: string; chainType?: string };
    if (!json?.destination) {
      throw new Error('ATXPPaymentDestination: /destination did not return destination');
    }
    if (!json?.chainType) {
      throw new Error('ATXPPaymentDestination: /destination did not return chainType');
    }

    return {
      destination: json.destination,
      network: json.chainType as Network
    };
  }
}