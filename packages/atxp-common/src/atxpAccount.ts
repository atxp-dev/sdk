import type { Account, PaymentMaker } from './types.js';
import type { FetchLike, Currency, AccountId, PaymentIdentifier, Destination, Chain, Source } from './types.js';
import BigNumber from 'bignumber.js';

function toBasicAuth(token: string): string {
  // Basic auth is base64("username:password"), password is blank
  const b64 = Buffer.from(`${token}:`).toString('base64');
  return `Basic ${b64}`;
}

function parseConnectionString(connectionString: string): { origin: string; token: string; accountId: string | null } {
  if (!connectionString || connectionString.trim() === '') {
    throw new Error('ATXPAccount: connection string is empty or not provided');
  }
  const url = new URL(connectionString);
  const origin = url.origin;
  const token = url.searchParams.get('connection_token') || '';
  const accountId = url.searchParams.get('account_id');
  if (!token) {
    throw new Error('ATXPAccount: connection string missing connection token');
  }
  // accountId is now optional - will be fetched from /me endpoint if not provided
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
  paymentMakers: PaymentMaker[];
  origin: string;
  token: string;
  fetchFn: FetchLike;
  private _cachedAccountId: AccountId | null = null;
  private _unqualifiedAccountId: string | null = null;
  private _accountIdPromise: Promise<AccountId> | null = null;

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; }) {
    const { origin, token, accountId } = parseConnectionString(connectionString);
    const fetchFn = opts?.fetchFn ?? fetch;

    // Store for use in X402 payment creation
    this.origin = origin;
    this.token = token;
    this.fetchFn = fetchFn;

    // If accountId was provided in connection string, cache it immediately
    if (accountId) {
      this._unqualifiedAccountId = accountId;
      this._cachedAccountId = `atxp:${accountId}` as AccountId;
    }

    this.paymentMakers = [
      new ATXPHttpPaymentMaker(origin, token, fetchFn)
    ];
  }

  /**
   * Get the account ID, fetching from /me endpoint if not provided in connection string.
   * The result is cached after the first fetch.
   */
  async getAccountId(): Promise<AccountId> {
    // Return cached value if available
    if (this._cachedAccountId) {
      return this._cachedAccountId;
    }

    // If already fetching, return the existing promise to avoid duplicate requests
    if (this._accountIdPromise) {
      return this._accountIdPromise;
    }

    // Fetch from /me endpoint
    this._accountIdPromise = this.fetchAccountIdFromMe();
    return this._accountIdPromise;
  }

  /**
   * Fetch account ID from the /me endpoint using Bearer auth
   */
  private async fetchAccountIdFromMe(): Promise<AccountId> {
    const response = await this.fetchFn(`${this.origin}/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /me failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as { account_id?: string };
    if (!json?.account_id) {
      throw new Error('ATXPAccount: /me did not return account_id');
    }

    // Cache the result
    this._unqualifiedAccountId = json.account_id;
    this._cachedAccountId = `atxp:${json.account_id}` as AccountId;
    return this._cachedAccountId;
  }

  /**
   * Get the unqualified account ID (without atxp: prefix), fetching if needed
   */
  private async getUnqualifiedAccountId(): Promise<string> {
    if (this._unqualifiedAccountId) {
      return this._unqualifiedAccountId;
    }
    // This will populate _unqualifiedAccountId as a side effect
    await this.getAccountId();
    return this._unqualifiedAccountId!;
  }

  /**
   * Get sources for this account by calling the accounts service
   */
  async getSources(): Promise<Source[]> {
    const unqualifiedAccountId = await this.getUnqualifiedAccountId();

    const response = await this.fetchFn(`${this.origin}/account/${unqualifiedAccountId}/sources`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /account/${unqualifiedAccountId}/sources failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as Source[];

    // The accounts service returns the sources array directly, not wrapped in an object
    if (!Array.isArray(json)) {
      throw new Error(`ATXPAccount: /account/${unqualifiedAccountId}/sources did not return sources array`);
    }

    return json;
  }
}
