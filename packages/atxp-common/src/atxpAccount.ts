import type { Account, PaymentMaker } from './types.js';
import type { FetchLike, Currency, AccountId, PaymentIdentifier, Destination, Chain, Source } from './types.js';
import BigNumber from 'bignumber.js';
import { crypto as platformCrypto } from './platform/index.js';

function toBasicAuth(token: string): string {
  // Basic auth is base64("username:password"), password is blank
  const b64 = Buffer.from(`${token}:`).toString('base64');
  return `Basic ${b64}`;
}

/**
 * Generate a deterministic account ID from a connection token (sync version).
 * Uses a simple hash algorithm that works synchronously in all environments.
 * This is used when the connection string doesn't include an explicit account_id.
 * The hash ensures the same token always produces the same ID without exposing the token.
 */
function generateDeterministicAccountIdSync(token: string): string {
  // Simple hash implementation for synchronous use
  // Uses djb2 hash algorithm - fast, deterministic, good distribution
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) + hash) ^ token.charCodeAt(i);
    hash = hash >>> 0; // Convert to unsigned 32-bit integer
  }

  // Also hash the reverse to get more bits and better distribution
  let hash2 = 5381;
  for (let i = token.length - 1; i >= 0; i--) {
    hash2 = ((hash2 << 5) + hash2) ^ token.charCodeAt(i);
    hash2 = hash2 >>> 0;
  }

  // Combine into a longer hex string for a more unique ID
  const combined = hash.toString(16).padStart(8, '0') + hash2.toString(16).padStart(8, '0');
  return `derived_${combined}`;
}

/**
 * Generate a deterministic account ID from a connection token (async version).
 * Uses SHA-256 for cryptographically strong hashing.
 */
async function generateDeterministicAccountIdAsync(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBytes = await platformCrypto.digest(data);
  const hashHex = platformCrypto.toHex(hashBytes);
  // Use first 32 characters (128 bits) for a reasonable ID length
  return `derived_${hashHex.substring(0, 32)}`;
}

function parseConnectionStringSync(connectionString: string): { origin: string; token: string; accountId: string | null } {
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
  /** True if accountId was derived from hashing the connection token (no explicit account_id in connection string) */
  readonly isDerivedAccountId: boolean;

  /**
   * Create an ATXPAccount from a connection string.
   *
   * If the connection string doesn't include an account_id, a deterministic ID
   * will be generated from the connection token hash. This allows the same token
   * to always produce the same accountId for consistent tracking.
   *
   * @param connectionString - The ATXP connection string (e.g., https://accounts.atxp.ai?connection_token=xxx&account_id=yyy)
   * @param opts - Optional configuration including fetchFn
   */
  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; }) {
    const { origin, token, accountId: explicitAccountId } = parseConnectionStringSync(connectionString);
    const fetchFn = opts?.fetchFn ?? fetch;

    this.origin = origin;
    this.token = token;
    this.fetchFn = fetchFn;

    let accountId: string;
    if (explicitAccountId) {
      accountId = explicitAccountId;
      this.isDerivedAccountId = false;
    } else {
      // Generate deterministic account ID from token hash (sync version)
      accountId = generateDeterministicAccountIdSync(token);
      this.isDerivedAccountId = true;
    }

    // Format accountId as network:address
    // Connection string provides just the atxp_acct_xxx part (no prefix for UI)
    this.unqualifiedAccountId = accountId;
    this.accountId = `atxp:${accountId}` as AccountId;
    this.paymentMakers = [
      new ATXPHttpPaymentMaker(origin, token, fetchFn)
    ];
  }

  /**
   * Create an ATXPAccount from a connection string (async version).
   *
   * If the connection string doesn't include an account_id, a deterministic ID
   * will be generated using SHA-256 hash of the connection token.
   *
   * Use this method when you need cryptographically strong hashing.
   * The regular constructor uses a faster but simpler hash algorithm.
   *
   * @param connectionString - The ATXP connection string
   * @param opts - Optional configuration including fetchFn
   */
  static async create(connectionString: string, opts?: { fetchFn?: FetchLike; }): Promise<ATXPAccount> {
    const { token, accountId: explicitAccountId } = parseConnectionStringSync(connectionString);

    // If we have an explicit account ID, just use the constructor
    if (explicitAccountId) {
      return new ATXPAccount(connectionString, opts);
    }

    // Generate deterministic account ID from SHA-256 hash
    const derivedAccountId = await generateDeterministicAccountIdAsync(token);

    // Create account and override the sync-derived ID with the async one
    const account = new ATXPAccount(connectionString, opts);
    // Use Object.defineProperty to update the readonly field
    Object.defineProperty(account, 'unqualifiedAccountId', { value: derivedAccountId });
    Object.defineProperty(account, 'accountId', { value: `atxp:${derivedAccountId}` as AccountId });

    return account;
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
