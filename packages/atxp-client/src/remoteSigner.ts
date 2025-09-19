import { Hex, Address, LocalAccount, SignableMessage, TypedData, TransactionSerializable } from 'viem';
import { FetchLike } from '@atxp/common';

function toBasicAuth(token: string): string {
  // Basic auth is base64("username:password"), password is blank
  const b64 = Buffer.from(`${token}:`).toString('base64');
  return `Basic ${b64}`;
}

/**
 * Creates a remote signer that delegates signing operations to the accounts-x402 API.
 * This implements the LocalAccount interface from viem to be compatible with x402-fetch.
 */
export class RemoteSigner implements LocalAccount {
  public readonly type = 'local' as const;

  constructor(
    public readonly address: Address,
    private origin: string,
    private token: string,
    private fetchFn: FetchLike = fetch as FetchLike
  ) {}

  /**
   * Sign a typed data structure using EIP-712
   * This is what x402 library will call for EIP-3009 authorization
   */
  async signTypedData<
    const TTypedData extends TypedData | { [key: string]: unknown }
  >(typedData: TTypedData): Promise<Hex> {
    const response = await this.fetchFn(`${this.origin}/sign-typed-data`, {
      method: 'POST',
      headers: {
        'Authorization': toBasicAuth(this.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        typedData
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to sign typed data: ${response.status} ${response.statusText} ${errorText}`);
    }

    const result = await response.json();
    return result.signature as Hex;
  }

  /**
   * Sign a message - required by LocalAccount interface but not used for X402
   */
  async signMessage(_: { message: SignableMessage }): Promise<Hex> {
    throw new Error('Message signing not implemented for remote signer');
  }

  /**
   * Sign a transaction - required by LocalAccount interface but not used for X402
   */
  async signTransaction(_transaction: TransactionSerializable, _args?: unknown): Promise<Hex> {
    throw new Error('Transaction signing not implemented for remote signer');
  }

  /**
   * Get public key - required by LocalAccount interface
   */
  readonly publicKey = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

  /**
   * Source - required by LocalAccount interface (set to 'custom')
   */
  readonly source = 'custom' as const;
}

/**
 * Create a remote signer for use with x402-fetch
 * @param address The address of the account
 * @param origin The origin URL of the accounts-x402 API
 * @param token The connection token for authentication
 * @param fetchFn Optional fetch function to use
 */
export function createRemoteSigner(
  address: Address,
  origin: string,
  token: string,
  fetchFn?: FetchLike
): RemoteSigner {
  return new RemoteSigner(address, origin, token, fetchFn);
}