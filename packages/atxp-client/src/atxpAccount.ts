import type { Account, PaymentMaker } from './types.js';
import type { FetchLike, Network, Currency } from '@atxp/common'
import BigNumber from 'bignumber.js';
import { LocalAccount } from 'viem';
import { RemoteSigner } from './remoteSigner.js';

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
  paymentMakers: { [key: string]: PaymentMaker };
  private origin: string;
  private token: string;
  private fetchFn: FetchLike;

  constructor(connectionString: string, opts?: { fetchFn?: FetchLike; network?: Network }) {
    const { origin, token } = parseConnectionString(connectionString);
    const fetchFn = opts?.fetchFn ?? fetch;
    const network = opts?.network ?? 'base';

    // Store for use in X402 payment creation
    this.origin = origin;
    this.token = token;
    this.fetchFn = fetchFn;

    // Use token as a stable accountId namespace to keep OAuth/ATXP state per-connection
    this.accountId = `atxp:${token}`;
    this.paymentMakers = {
      [network]: new ATXPHttpPaymentMaker(origin, token, fetchFn),
    };
  }


  /**
   * Get a signer that can be used with the x402 library
   * This uses RemoteSigner to delegate signing to the accounts-x402 server
   */
  async getSigner(): Promise<LocalAccount> {
    // Get the wallet address from the destination endpoint
    const response = await this.fetchFn(`${this.origin}/destination`, {
      headers: {
        'Authorization': toBasicAuth(this.token)
      }
    });

    if (!response.ok) {
      throw new Error(`ATXPAccount: Failed to get wallet address: ${response.status} ${response.statusText}`);
    }

    const { destination } = await response.json() as { destination: string };

    return new RemoteSigner(
      destination as `0x${string}`,
      this.origin,
      this.token,
      this.fetchFn
    );
  }
}