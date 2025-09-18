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
   * Create an X402 payment header by calling the accounts-x402 server
   * @param x402Challenge The X402 challenge object from the 402 response
   * @returns The X402 payment header to send in the retry request
   */
  async createX402Payment(x402Challenge: { x402Version: number; accepts: any[] }): Promise<string> {
    const response = await this.fetchFn(`${this.origin}/create-x402-payment`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(x402Challenge),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ATXPAccount: Failed to create X402 payment: ${response.status} ${response.statusText} ${text}`);
    }

    const result = await response.json() as { paymentHeader?: string };
    if (!result?.paymentHeader) {
      throw new Error('ATXPAccount: Server did not return payment header');
    }

    return result.paymentHeader;
  }

  /**
   * Get a signer that can be used with the x402 library
   * This will use RemoteSigner to delegate signing to the accounts-x402 server
   * NOTE: This requires the accounts-x402 server to implement a signTypedData endpoint
   */
  getSigner(): LocalAccount {
    // TODO: We need to get the wallet address from the accounts-x402 server
    // For now, throw an error indicating this is not yet implemented
    throw new Error('ATXPAccount.getSigner() is not yet implemented - requires signTypedData endpoint on accounts-x402 server');

    // Future implementation:
    // return new RemoteSigner(
    //   walletAddress,
    //   this.origin,
    //   this.fetchFn
    // );
  }
}