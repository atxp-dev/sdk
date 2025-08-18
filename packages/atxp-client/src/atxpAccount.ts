import type { Account, PaymentMaker } from './types.js';
import type { FetchLike } from '@atxp/common'
import BigNumber from 'bignumber.js';

function toBasicAuth(token: string): string {
  // Basic auth is base64("username:password"), password is blank
  const b64 = Buffer.from(`${token}:`).toString('base64');
  return `Basic ${b64}`;
}

function parseConnectionString(connectionString: string): { origin: string; token: string } {
  const url = new URL(connectionString);
  const origin = url.origin;
  const token = url.searchParams.get('connection_token') || '';
  if (!token) {
    throw new Error('ATXPAccount: connection string missing connection token');
  }
  return { origin, token };
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

  async makePayment(amount: BigNumber, currency: string, receiver: string, memo: string): Promise<string> {
    const body = {
      amount: amount.toString(),
      currency: (currency || '').toLowerCase() === 'usdc' ? 'usdc' : 'usdc',
      receiver,
      memo,
    };
    const response = await this.fetchFn(`${this.origin}/pay`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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
  paymentMakers: { [key: string]: PaymentMaker };

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; network?: string }) {
    const { origin, token } = parseConnectionString(connectionString);
    const fetchFn = opts?.fetchFn ?? fetch;
    const network = opts?.network ?? 'solana';

    // Use token as a stable accountId namespace to keep OAuth/ATXP state per-connection
    this.accountId = `atxp:${token}`;
    this.paymentMakers = {
      [network]: new ATXPHttpPaymentMaker(origin, token, fetchFn),
    };
  }
}


