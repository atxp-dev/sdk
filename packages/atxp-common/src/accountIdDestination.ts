import type { PaymentDestination, AccountId, Source, FetchLike } from './types.js';
import { DEFAULT_ATXP_ACCOUNTS_SERVER } from './types.js';

/**
 * A lightweight PaymentDestination implementation that only requires an account ID.
 *
 * Use this when you need a destination for server middleware but don't have
 * (or need) a full connection string with connection_token. This is useful for
 * sprites and other services that receive payments but don't need to make payments.
 *
 * The account ID can be either:
 * - A fully qualified ID (e.g., "atxp:abc123")
 * - An unqualified ID (e.g., "abc123") which will be prefixed with "atxp:"
 */
export class AccountIdDestination implements PaymentDestination {
  private accountId: AccountId;
  private unqualifiedAccountId: string;
  private accountsBaseUrl: string;
  private fetchFn: FetchLike;

  constructor(
    accountId: string,
    opts?: {
      accountsBaseUrl?: string;
      fetchFn?: FetchLike;
    }
  ) {
    // Handle both qualified (atxp:abc123) and unqualified (abc123) account IDs
    if (accountId.includes(':')) {
      this.accountId = accountId as AccountId;
      this.unqualifiedAccountId = accountId.split(':')[1];
    } else {
      this.accountId = `atxp:${accountId}` as AccountId;
      this.unqualifiedAccountId = accountId;
    }

    this.accountsBaseUrl = opts?.accountsBaseUrl ?? DEFAULT_ATXP_ACCOUNTS_SERVER;
    this.fetchFn = opts?.fetchFn ?? fetch;
  }

  async getAccountId(): Promise<AccountId> {
    return this.accountId;
  }

  async getSources(): Promise<Source[]> {
    const response = await this.fetchFn(
      `${this.accountsBaseUrl}/account/${this.unqualifiedAccountId}/sources`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `AccountIdDestination: /account/${this.unqualifiedAccountId}/sources failed: ${response.status} ${response.statusText} ${text}`
      );
    }

    const json = await response.json() as Source[];

    if (!Array.isArray(json)) {
      throw new Error(
        `AccountIdDestination: /account/${this.unqualifiedAccountId}/sources did not return sources array`
      );
    }

    return json;
  }
}
