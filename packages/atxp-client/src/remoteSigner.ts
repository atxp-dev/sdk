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
    private fetchFn: FetchLike = fetch as FetchLike
  ) {}

  /**
   * Sign a typed data structure using EIP-712
   * This is what x402-fetch will call for EIP-3009 authorization
   */
  async signTypedData<
    const TTypedData extends TypedData | { [key: string]: unknown },
    TPrimaryType extends string = string,
  >(typedData: TTypedData): Promise<Hex> {
    // Extract the actual typed data parameters
    const { domain, types, primaryType, message } = typedData as any;

    // For EIP-3009, we need to send this to accounts-x402's /create-payment-authorization endpoint
    if (primaryType === 'TransferWithAuthorization') {
      const response = await this.fetchFn(`${this.accountsApiUrl}/create-payment-authorization`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          value: message.value,
          validAfter: message.validAfter,
          validBefore: message.validBefore,
          nonce: message.nonce,
          asset: domain.verifyingContract,
          network: this.getNetworkFromChainId(domain.chainId),
          extra: {
            name: domain.name,
            version: domain.version
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign authorization: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result.signature as Hex;
    }

    throw new Error('Unsupported typed data signing');
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

  /**
   * Get chain ID from network - helper method
   */
  private getNetworkFromChainId(chainId: number): string {
    const chainIdToNetwork: { [key: number]: string } = {
      8453: 'base',
      84532: 'base-sepolia',
      43114: 'avalanche',
      43113: 'avalanche-fuji',
      1329: 'sei',
      1328: 'sei-testnet'
    };

    return chainIdToNetwork[chainId] || 'base';
  }
}

/**
 * Create a remote signer for use with x402-fetch
 * @param address The address of the account
 * @param accountsApiUrl The URL of the accounts-x402 API
 * @param fetchFn Optional fetch function to use
 */
export function createRemoteSigner(
  address: Address,
  accountsApiUrl: string,
  fetchFn?: FetchLike
): RemoteSigner {
  return new RemoteSigner(address, accountsApiUrl, fetchFn);
}