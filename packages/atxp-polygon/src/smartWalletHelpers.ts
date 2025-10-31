import {
  http,
  createPublicClient,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { polygon, polygonAmoy } from 'viem/chains';
import type { Chain } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  toCoinbaseSmartAccount,
  createBundlerClient,
  type BundlerClient,
  type SmartAccount
} from 'viem/account-abstraction';

// Coinbase CDP API Key
const COINBASE_API_KEY = 'snPdXqIzOGhRkGNJvEHM5bl9Hm3yRO3m';

/**
 * Get Coinbase CDP Bundler URL for a given chain
 * NOTE: Verify Coinbase CDP support for Polygon before using in production
 */
function getCoinbaseBundlerUrl(chainId: number): string {
  switch (chainId) {
    case 137: // Polygon mainnet
      return 'https://api.developer.coinbase.com/rpc/v1/polygon-mainnet';
    case 80002: // Polygon Amoy testnet
      return 'https://api.developer.coinbase.com/rpc/v1/polygon-amoy';
    default:
      throw new Error(`Unsupported chain ID for Coinbase bundler: ${chainId}. Supported: 137 (mainnet), 80002 (Amoy testnet)`);
  }
}

/**
 * Get Coinbase CDP Paymaster URL for a given chain
 * NOTE: Verify Coinbase CDP support for Polygon before using in production
 */
function getCoinbasePaymasterUrl(chainId: number): string {
  switch (chainId) {
    case 137: // Polygon mainnet
      return 'https://api.developer.coinbase.com/rpc/v1/polygon-mainnet';
    case 80002: // Polygon Amoy testnet
      return 'https://api.developer.coinbase.com/rpc/v1/polygon-amoy';
    default:
      throw new Error(`Unsupported chain ID for Coinbase paymaster: ${chainId}. Supported: 137 (mainnet), 80002 (Amoy testnet)`);
  }
}

/**
 * Get Polygon chain configuration by chain ID
 */
function getPolygonChain(chainId: number): Chain {
  switch (chainId) {
    case 137:
      return polygon;
    case 80002:
      return polygonAmoy;
    default:
      throw new Error(`Unsupported Polygon chain ID: ${chainId}. Supported: 137 (mainnet), 80002 (Amoy testnet)`);
  }
}

export interface EphemeralSmartWallet {
  address: Address;
  client: BundlerClient;
  account: SmartAccount;
  signer: Account;
}

/**
 * Creates an ephemeral smart wallet with paymaster support
 * @param privateKey - Private key for the wallet signer
 * @param chainId - Chain ID (defaults to 137 for Polygon mainnet, or 80002 for Amoy testnet)
 *
 * NOTE: This implementation assumes Coinbase CDP supports Polygon.
 * Verify support and correct endpoint URLs before using in production.
 */
export async function toEphemeralSmartWallet(
  privateKey: Hex,
  chainId: number = polygon.id
): Promise<EphemeralSmartWallet> {
  const apiKey = COINBASE_API_KEY;
  const signer = privateKeyToAccount(privateKey);
  const chain = getPolygonChain(chainId);
  const bundlerUrl = getCoinbaseBundlerUrl(chainId);
  const paymasterUrl = getCoinbasePaymasterUrl(chainId);

  const publicClient = createPublicClient({
    chain,
    transport: http(`${bundlerUrl}/${apiKey}`)
  });

  // Create the Coinbase smart wallet
  const account = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [signer],
    version: '1'
  });

  // Create bundler client with paymaster support
  const bundlerClient = createBundlerClient({
    account,
    client: publicClient,
    transport: http(`${bundlerUrl}/${apiKey}`),
    chain,
    paymaster: true, // Enable paymaster sponsorship
    paymasterContext: {
      transport: http(`${paymasterUrl}/${apiKey}`)
    }
  });

  return {
    address: account.address,
    client: bundlerClient,
    account,
    signer,
  };
}
