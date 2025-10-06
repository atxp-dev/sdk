import type { Account, PaymentMaker } from './types.js';
import type { FetchLike, Network, Currency } from '@atxp/common'
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
  private network: Network;
  private fetchFn: FetchLike;

  constructor(origin: string, token: string, network: Network, fetchFn: FetchLike = fetch) {
    this.origin = origin;
    this.token = token;
    this.network = network;
    this.fetchFn = fetchFn;
  }

  async makePayment(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<string> {
    // Make a regular payment via the /pay endpoint
    const response = await this.fetchFn(`${this.origin}/pay`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount.toString(),
        network: this.network,
        currency,
        receiver,
        memo,
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

  async generateJWT(params: { paymentRequestId: string; codeChallenge: string }): Promise<string> {
    const response = await this.fetchFn(`${this.origin}/sign`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentRequestId: params.paymentRequestId,
        codeChallenge: params.codeChallenge,
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
  accountId: string;
  paymentMakers: { [key in Network]: PaymentMaker };
  origin: string;
  token: string;
  fetchFn: FetchLike;

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; }) {
    const { origin, token, accountId } = parseConnectionString(connectionString);
    const fetchFn = opts?.fetchFn ?? fetch;

    // Store for use in X402 payment creation
    this.origin = origin;
    this.token = token;
    this.fetchFn = fetchFn;

    if (accountId) {
      this.accountId = `atxp:${accountId}`;
    } else {
      this.accountId = `atxp:${crypto.randomUUID()}`;
    }
    this.paymentMakers = {
      ['base']: new ATXPHttpPaymentMaker(origin, token, 'base', fetchFn),
      ['solana']: new ATXPHttpPaymentMaker(origin, token, 'solana', fetchFn),
      ['world']: new ATXPHttpPaymentMaker(origin, token, 'world', fetchFn),
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