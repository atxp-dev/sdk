import { Hex, Address, LocalAccount, SignableMessage, TypedData, TransactionSerializable, Hash } from 'viem';
import { FetchLike } from '@atxp/common';

/**
 * Creates a remote signer that delegates signing operations to the accounts-x402 API.
 * This implements the LocalAccount interface from viem to be compatible with x402-fetch.
 */
export class RemoteSigner implements LocalAccount {
  public readonly type = 'local' as const;

  constructor(
    public readonly address: Address,
    private accountsApiUrl: string,
    private authorizationHeader: string,
    private fetchFn: FetchLike = fetch as FetchLike
  ) {}

  /**
   * Sign a typed data structure using EIP-712
   * This is what x402 library will call for EIP-3009 authorization
   */
  async signTypedData<
    const TTypedData extends TypedData | { [key: string]: unknown },
    TPrimaryType extends string = string,
  >(typedData: TTypedData): Promise<Hex> {
    const response = await this.fetchFn(`${this.accountsApiUrl}/sign-typed-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add authorization header if we have a token
        ...(this.authorizationHeader ? { 'Authorization': this.authorizationHeader } : {})
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
  async signMessage({ message }: { message: SignableMessage }): Promise<Hex> {
    throw new Error('Message signing not implemented for remote signer');
  }

  /**
   * Sign a transaction - required by LocalAccount interface but not used for X402
   */
  async signTransaction(transaction: TransactionSerializable, args?: any): Promise<Hex> {
    throw new Error('Transaction signing not implemented for remote signer');
  }

  /**
   * Get public key - required by LocalAccount interface
   */
  async publicKey(): Promise<Hex> {
    // Return a dummy public key since we don't have access to it
    return '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
  }
}

/**
 * Create a remote signer for use with x402-fetch
 * @param address The address of the account
 * @param accountsApiUrl The URL of the accounts-x402 API
 * @param authorizationHeader The authorization header to use for API calls
 * @param fetchFn Optional fetch function to use
 */
export function createRemoteSigner(
  address: Address,
  accountsApiUrl: string,
  authorizationHeader: string,
  fetchFn?: FetchLike
): RemoteSigner {
  return new RemoteSigner(address, accountsApiUrl, authorizationHeader, fetchFn);
}