import type { Account, PaymentMaker } from './types.js';
import type { FetchLike, Network, Currency, AccountId } from '@atxp/common'
import { crypto } from '@atxp/common';
import BigNumber from 'bignumber.js';
import { LocalAccount } from 'viem';
import { ATXPLocalAccount } from './atxpLocalAccount.js';

function toBasicAuth(token: string): string {
  // Basic auth is base64("username:password"), password is blank
  const b64 = Buffer.from(`${token}:`).toString('base64');
  return `Basic ${b64}`;
}

function parseConnectionString(connectionString: string): { origin: string; token: string; accountId: string | null } {
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

  async makePayment(amount: BigNumber, currency: Currency, receiver: string, memo: string, paymentRequestId?: string): Promise<string> {
    // Make a regular payment via the /pay endpoint
    const response = await this.fetchFn(`${this.origin}/pay`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount.toString(),
        currency,
        receiver,
        memo,
        ...(paymentRequestId && { paymentRequestId })
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: /pay failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json() as { txHash?: string };
    if (!json?.txHash) {
      throw new Error('ATXPAccount: /pay did not return txHash');
    }
    return json.txHash;
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
  paymentMakers: { [key: string]: PaymentMaker };
  origin: string;
  token: string;
  fetchFn: FetchLike;

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; network?: Network }) {
    const { origin, token, accountId } = parseConnectionString(connectionString);
    const fetchFn = opts?.fetchFn ?? fetch;
    const network = opts?.network ?? 'base';

    // Store for use in X402 payment creation
    this.origin = origin;
    this.token = token;
    this.fetchFn = fetchFn;

    // Format accountId as network:address
    // Connection string provides just the atxp_acct_xxx part (no prefix for UI)
    if (accountId) {
      this.accountId = `atxp:${accountId}` as AccountId;
    } else {
      this.accountId = `atxp:atxp_${crypto.randomUUID()}` as AccountId;
    }
    this.paymentMakers = {
      [network]: new ATXPHttpPaymentMaker(origin, token, fetchFn),
    };
  }

  async getSigner(): Promise<LocalAccount> {
    return ATXPLocalAccount.create(
      this.origin,
      this.token,
      this.fetchFn
    );
  }
}