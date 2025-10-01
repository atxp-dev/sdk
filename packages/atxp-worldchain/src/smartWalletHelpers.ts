import {
  http,
  createPublicClient,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  toCoinbaseSmartAccount,
  createBundlerClient,
  type BundlerClient,
  type SmartAccount
} from 'viem/account-abstraction';
import { getWorldChainByChainId } from '@atxp/client';

// Default RPC URLs for World Chain
export const DEFAULT_WORLD_CHAIN_MAINNET_RPC = 'https://worldchain-mainnet.g.alchemy.com/public';
export const DEFAULT_WORLD_CHAIN_SEPOLIA_RPC = 'https://worldchain-sepolia.g.alchemy.com/public';

/**
 * Get default RPC URL for a World Chain by chain ID
 */
export const getDefaultWorldChainRPC = (chainId: number): string => {
  switch (chainId) {
    case 480: // Mainnet
      return DEFAULT_WORLD_CHAIN_MAINNET_RPC;
    case 4801: // Sepolia
      return DEFAULT_WORLD_CHAIN_SEPOLIA_RPC;
    default:
      throw new Error(`Unsupported World Chain ID: ${chainId}`);
  }
};

export interface EphemeralSmartWallet {
  address: Address;
  client: BundlerClient;
  account: SmartAccount;
  signer: Account;
}

/**
 * Creates an ephemeral smart wallet for World Chain
 * Note: This implementation uses Coinbase's smart wallet infrastructure
 * adapted for World Chain. This may need updates when World Chain
 * provides their own account abstraction infrastructure.
 *
 * @param privateKey - Private key for the wallet signer
 * @param rpcUrl - Optional custom RPC URL
 * @param chainId - Chain ID (defaults to 480 for mainnet)
 */
export async function toEphemeralSmartWallet(
  privateKey: Hex,
  rpcUrl?: string,
  chainId: number = 480
): Promise<EphemeralSmartWallet> {
  const signer = privateKeyToAccount(privateKey);
  const chainConfig = getWorldChainByChainId(chainId);
  const defaultRpc = getDefaultWorldChainRPC(chainId);

  const publicClient = createPublicClient({
    chain: chainConfig,
    transport: http(rpcUrl || defaultRpc)
  });

  // Create the smart wallet using Coinbase's smart account SDK
  // This will need to be adapted when World Chain provides their own solution
  const account = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [signer],
    version: '1'
  });

  // Create bundler client
  // Note: World Chain may not have paymaster support initially
  const bundlerClient = createBundlerClient({
    account,
    client: publicClient,
    transport: http(rpcUrl || defaultRpc),
    chain: chainConfig
    // Paymaster omitted - World Chain infrastructure may not support it yet
  });

  return {
    address: account.address,
    client: bundlerClient,
    account,
    signer,
  };
}