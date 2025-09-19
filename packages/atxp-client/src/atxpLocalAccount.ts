import { Hex, Address, LocalAccount, SignableMessage, TypedData, TransactionSerializable } from 'viem';
import { FetchLike } from '@atxp/common';

function toBasicAuth(token: string): string {
  // Basic auth is base64("username:password"), password is blank
  const b64 = Buffer.from(`${token}:`).toString('base64');
  return `Basic ${b64}`;
}

/**
 * ATXP implementation of viem's LocalAccount interface.
 * Delegates signing operations to the accounts-x402 API.
 * Includes properties needed by x402 library for wallet client compatibility.
 */
export class ATXPLocalAccount implements LocalAccount {
  public readonly type = 'local' as const;

  // Properties needed by x402 library's isSignerWallet check
  public readonly account: LocalAccount;
  public readonly chain: { id: number };
  public readonly transport: {};

  constructor(
    public readonly address: Address,
    private origin: string,
    private token: string,
    private fetchFn: FetchLike = fetch as FetchLike
  ) {
    // x402 library expects these properties for wallet client compatibility
    this.account = this; // Self-reference for x402's isSignerWallet check
    this.chain = { id: 8453 }; // Base mainnet - could make this configurable
    this.transport = {}; // Empty transport object for x402 compatibility
  }

  /**
   * Fetch the wallet address from the /address endpoint
   */
  static async create(
    origin: string,
    token: string,
    fetchFn: FetchLike = fetch as FetchLike
  ): Promise<ATXPLocalAccount> {
    // The /address endpoint uses Basic auth like other authenticated endpoints
    const response = await fetchFn(`${origin}/address`, {
      method: 'GET',
      headers: {
        'Authorization': toBasicAuth(token)
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch destination address: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json() as { address?: string; chainType?: string };
    const address = data.address;
    if (!address) {
      throw new Error('Address endpoint did not return an address');
    }

    // Check that the account is an Ethereum account (required for X402/EVM operations)
    if (!data.chainType) {
      throw new Error('Address endpoint did not return a chainType');
    }
    if (data.chainType !== 'ethereum') {
      throw new Error(`ATXPLocalAccount requires an Ethereum account, but got ${data.chainType} account`);
    }

    return new ATXPLocalAccount(address as Address, origin, token, fetchFn);
  }

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
    throw new Error('Message signing not implemented for ATXP local account');
  }

  /**
   * Sign a transaction - required by LocalAccount interface but not used for X402
   */
  async signTransaction(_transaction: TransactionSerializable, _args?: unknown): Promise<Hex> {
    throw new Error('Transaction signing not implemented for ATXP local account');
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

