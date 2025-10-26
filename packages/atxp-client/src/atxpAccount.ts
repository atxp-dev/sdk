import type { Account, PaymentMaker } from './types.js';
import type { FetchLike, Currency, AccountId, PaymentIdentifier, Destination, Chain, Source } from '@atxp/common'
import { crypto } from '@atxp/common';
import BigNumber from 'bignumber.js';
import { LocalAccount } from 'viem';
import { ATXPLocalAccount } from './atxpLocalAccount.js';

function toBasicAuth(token: string): string {
  // Basic auth is base64("username:password"), password is blank
  const b64 = Buffer.from(`${token}:`).toString('base64');
  return `Basic ${b64}`;
}

function parseConnectionString(connectionString: string): { origin: string; token: string; accountId: string } {
  const url = new URL(connectionString);
  const origin = url.origin;
  const token = url.searchParams.get('connection_token') || '';
  const accountId = url.searchParams.get('account_id');
  if (!token) {
    throw new Error('ATXPAccount: connection string missing connection token');
  }
  if (!accountId) {
    throw new Error('ATXPAccount: connection string missing account id');
  }
  return { origin, token, accountId };
}

class ATXPHttpPaymentMaker implements PaymentMaker {
  private origin: string;
  private token: string;
  private fetchFn: FetchLike;

  constructor(origin: string, token: string, fetchFn: FetchLike = fetch) {
    this.origin = origin;
    this.token = token;
    this.fetchFn = fetchFn;
  }

  async getSourceAddress(params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}): Promise<string> {
    // Call the /address_for_payment endpoint to get the source address for this account
    const response = await this.fetchFn(`${this.origin}/address_for_payment`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amount.toString(),
        currency: params.currency,
        receiver: params.receiver,
        memo: params.memo,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /address_for_payment failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as { sourceAddress?: string; sourceNetwork?: string };
    if (!json?.sourceAddress) {
      throw new Error('ATXPAccount: /address_for_payment did not return sourceAddress');
    }
    return json.sourceAddress;
  }

  async makePayment(destinations: Destination[], memo: string, paymentRequestId?: string): Promise<PaymentIdentifier | null> {
    // Make a payment via the /pay endpoint with multiple destinations
    const response = await this.fetchFn(`${this.origin}/pay`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destinations: destinations.map(d => ({
          chain: d.chain,
          address: d.address,
          amount: d.amount.toString(),
          currency: d.currency
        })),
        memo,
        ...(paymentRequestId && { paymentRequestId })
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /pay failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as {
      transactionId?: string;
      txHash?: string; // Backwards compatibility
      transactionSubId?: string;
      chain?: string;
      currency?: string;
    };

    const transactionId = json.transactionId;
    if (!transactionId) {
      throw new Error('ATXPAccount: /pay did not return transactionId or txHash');
    }
    if (!json?.chain) {
      throw new Error('ATXPAccount: /pay did not return chain');
    }
    if (!json?.currency) {
      throw new Error('ATXPAccount: /pay did not return currency');
    }

    return {
      transactionId,
      ...(json.transactionSubId ? { transactionSubId: json.transactionSubId } : {}),
      chain: json.chain as Chain,
      currency: json.currency as Currency
    };
  }

  async generateJWT(params: { paymentRequestId: string; codeChallenge: string; accountId?: AccountId | null }): Promise<string> {
    const response = await this.fetchFn(`${this.origin}/sign`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentRequestId: params.paymentRequestId,
        codeChallenge: params.codeChallenge,
        ...(params.accountId ? { accountId: params.accountId } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /sign failed: ${response.status} ${response.statusText} ${text}`);
    }
    const json = await response.json() as { jwt?: string };
    if (!json?.jwt) {
      throw new Error('ATXPAccount: /sign did not return jwt');
    }
    return json.jwt;
  }
}

export class ATXPAccount implements Account {
  accountId: AccountId;
  paymentMakers: PaymentMaker[];
  origin: string;
  token: string;
  fetchFn: FetchLike;
  private unqualifiedAccountId: string;

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; }) {
    const { origin, token, accountId } = parseConnectionString(connectionString);
    const fetchFn = opts?.fetchFn ?? fetch;

    // Store for use in X402 payment creation
    this.origin = origin;
    this.token = token;
    this.fetchFn = fetchFn;

    // Format accountId as network:address
    // Connection string provides just the atxp_acct_xxx part (no prefix for UI)
    this.unqualifiedAccountId = accountId;
    this.accountId = `atxp:${accountId}` as AccountId;
    this.paymentMakers = [
      new ATXPHttpPaymentMaker(origin, token, fetchFn)
    ];
  }


  async getSigner(): Promise<LocalAccount> {
    return ATXPLocalAccount.create(
      this.origin,
      this.token,
      this.fetchFn
    );
  }

  /**
   * Get sources for this account by calling the accounts service
   */
  async getSources(): Promise<Source[]> {
    // Use the unqualified account ID (without atxp: prefix) for the API call
    const response = await this.fetchFn(`${this.origin}/account/${this.unqualifiedAccountId}/sources`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /account/${this.unqualifiedAccountId}/sources failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as Source[];

    // The accounts service returns the sources array directly, not wrapped in an object
    if (!Array.isArray(json)) {
      throw new Error(`ATXPAccount: /account/${this.unqualifiedAccountId}/sources did not return sources array`);
    }

    return json;
  }
}