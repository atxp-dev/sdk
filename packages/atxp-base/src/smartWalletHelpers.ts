import {
  http,
  createPublicClient,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
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
 */
function getCoinbaseBundlerUrl(chainId: number): string {
  switch (chainId) {
    case 8453: // Base mainnet
      return 'https://api.developer.coinbase.com/rpc/v1/base';
    case 84532: // Base Sepolia
      return 'https://api.developer.coinbase.com/rpc/v1/base-sepolia';
    default:
      throw new Error(`Unsupported chain ID for Coinbase bundler: ${chainId}`);
  }
}

/**
 * Get Coinbase CDP Paymaster URL for a given chain
 */
function getCoinbasePaymasterUrl(chainId: number): string {
  switch (chainId) {
    case 8453: // Base mainnet
      return 'https://api.developer.coinbase.com/rpc/v1/base';
    case 84532: // Base Sepolia
      return 'https://api.developer.coinbase.com/rpc/v1/base-sepolia';
    default:
      throw new Error(`Unsupported chain ID for Coinbase paymaster: ${chainId}`);
  }
}

/**
 * Get Base chain configuration by chain ID
 */
function getBaseChain(chainId: number): Chain {
  switch (chainId) {
    case 8453:
      return base;
    case 84532:
      return baseSepolia;
    default:
      throw new Error(`Unsupported Base chain ID: ${chainId}. Supported: 8453 (mainnet), 84532 (sepolia)`);
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
 * @param chainId - Chain ID (defaults to 8453 for Base mainnet, can be 84532 for Base Sepolia)
 */
export async function toEphemeralSmartWallet(
  privateKey: Hex,
  chainId: number = base.id
): Promise<EphemeralSmartWallet> {
  const apiKey = COINBASE_API_KEY;
  const signer = privateKeyToAccount(privateKey);
  const chain = getBaseChain(chainId);
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