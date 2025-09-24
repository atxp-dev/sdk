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
import { WORLD_CHAIN_MAINNET } from '@atxp/client';

// For now, we'll use a generic approach for World Chain
// This may need to be updated when World Chain provides specific infrastructure
const DEFAULT_WORLD_CHAIN_RPC = 'https://worldchain-mainnet.g.alchemy.com/public';

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
 */
export async function toEphemeralSmartWallet(
  privateKey: Hex,
  rpcUrl?: string
): Promise<EphemeralSmartWallet> {
  const signer = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: WORLD_CHAIN_MAINNET,
    transport: http(rpcUrl || DEFAULT_WORLD_CHAIN_RPC)
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
    transport: http(rpcUrl || DEFAULT_WORLD_CHAIN_RPC),
    chain: WORLD_CHAIN_MAINNET
    // Paymaster omitted - World Chain infrastructure may not support it yet
  });

  return {
    address: account.address,
    client: bundlerClient,
    account,
    signer,
  };
}