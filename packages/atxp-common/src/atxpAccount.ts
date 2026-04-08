import type { Account, PaymentMaker, MeResponse, AuthorizeParams, AuthorizeResult, PaymentProtocol } from './types.js';
import type { FetchLike, Currency, AccountId, PaymentIdentifier, Destination, Chain, Source } from './types.js';
import { AuthorizationError } from './types.js';
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
  readonly usesAccountsAuthorize = true;
  paymentMakers: PaymentMaker[];
  origin: string;
  token: string;
  fetchFn: FetchLike;
  private _cachedAccountId: AccountId | null = null;
  private _unqualifiedAccountId: string | null = null;
  private _accountIdPromise: Promise<AccountId> | null = null;
  private _cachedProfile: MeResponse | null = null;
  private _profilePromise: Promise<MeResponse> | null = null;

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
   * Get the full /me profile, fetching if not already cached.
   * If getAccountId() was satisfied from the connection string (no /me call),
   * this will make a /me request to get the full profile.
   */
  async getProfile(): Promise<MeResponse> {
    if (this._cachedProfile) {
      return this._cachedProfile;
    }
    if (!this._profilePromise) {
      this._profilePromise = this.fetchAccountIdFromMe().then(() => {
        if (!this._cachedProfile) {
          throw new Error('ATXPAccount: /me succeeded but profile was not cached');
        }
        return this._cachedProfile;
      });
    }
    return this._profilePromise;
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

    const json = await response.json() as MeResponse;
    if (!json?.accountId) {
      throw new Error('ATXPAccount: /me did not return accountId');
    }

    // Cache the full profile and account ID
    this._cachedProfile = json;
    this._unqualifiedAccountId = json.accountId;
    this._cachedAccountId = `atxp:${json.accountId}` as AccountId;
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

  /**
   * Create a spend permission for the given resource URL.
   * This is an ATXP-specific feature that allows pre-authorizing spending
   * for a specific MCP server during OAuth authorization.
   *
   * @param resourceUrl - The MCP server URL to create a spend permission for
   * @returns The spend permission token to pass to the authorization URL
   */
  async createSpendPermission(resourceUrl: string): Promise<string> {
    const response = await this.fetchFn(`${this.origin}/spend-permission`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resourceUrl }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /spend-permission failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as { spendPermissionToken?: string };
    if (!json?.spendPermissionToken) {
      throw new Error('ATXPAccount: /spend-permission did not return spendPermissionToken');
    }

    return json.spendPermissionToken;
  }

  /**
   * Authorize a payment through the accounts service.
   * Calls /authorize/auto and returns an opaque credential.
   */
  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    if (!params.protocols || params.protocols.length === 0) {
      throw new Error('ATXPAccount: protocols array must not be empty');
    }

    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': toBasicAuth(this.token),
    };

    const body: Record<string, unknown> = {
      protocols: params.protocols,
    };
    // ATXP fields
    if (params.amount) body.amount = params.amount.toString();
    if (params.destination) body.receiver = params.destination;
    if (params.memo) body.memo = params.memo;
    body.currency = 'USDC';
    // X402 fields
    if (params.paymentRequirements) body.paymentRequirements = params.paymentRequirements;
    // MPP fields
    if (params.challenge) body.challenge = params.challenge;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.origin}/authorize/auto`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorCode = 'authorization_failed';
      try {
        const parsed = JSON.parse(errorText);
        errorCode = parsed.error || errorCode;
      } catch { /* not JSON */ }
      throw new AuthorizationError(
        `ATXPAccount: /authorize/auto failed (${response.status}): ${errorText}`,
        response.status,
        errorCode,
      );
    }

    const responseBody = await response.json() as { protocol: string; credential: string; context?: Record<string, unknown> };

    if (!responseBody || typeof responseBody.protocol !== 'string' || typeof responseBody.credential !== 'string') {
      throw new AuthorizationError(
        'ATXPAccount: /authorize/auto response missing protocol or credential',
        500, 'malformed_response'
      );
    }

    const protocol = responseBody.protocol as PaymentProtocol;

    let credential: string;
    if (protocol === 'atxp') {
      // Inject the connection token so the credential is self-contained
      const credentialObj = JSON.parse(responseBody.credential);
      credentialObj.sourceAccountToken = this.token;
      credential = JSON.stringify(credentialObj);
    } else {
      credential = responseBody.credential;
    }

    return { protocol, credential, ...(responseBody.context && { context: responseBody.context }) };
  }
}
