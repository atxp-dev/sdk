import { 
  http, 
  createPublicClient, 
  type Account,
  type Address,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { 
  toCoinbaseSmartAccount,
  createBundlerClient,
  createPaymasterClient,
  type BundlerClient,
  type SmartAccount
} from 'viem/account-abstraction';

// Coinbase CDP Paymaster and Bundler endpoints
const COINBASE_BUNDLER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';
const COINBASE_PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';

export interface SmartWalletConfig {
  apiKey: string;
  paymasterUrl?: string;
  bundlerUrl?: string;
}

export interface EphemeralSmartWallet {
  address: Address;
  client: BundlerClient;
  account: SmartAccount;
  signer: Account;
}

/**
 * Creates an ephemeral smart wallet with paymaster support
 */
export async function createEphemeralSmartWallet(
  privateKey: `0x${string}`,
  config: SmartWalletConfig
): Promise<EphemeralSmartWallet> {
  // Create the ephemeral signer
  const signer = privateKeyToAccount(privateKey);
  
  // Create public client
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.bundlerUrl || `${COINBASE_BUNDLER_URL}/${config.apiKey}`)
  });
  
  // Create the Coinbase smart wallet
  const account = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [signer],
    version: '1'
  });
  
  // Log the smart wallet address
  console.log('Smart wallet address:', account.address);
  
  // Create bundler client with paymaster support
  const bundlerClient = createBundlerClient({
    account,
    client: publicClient,
    transport: http(config.bundlerUrl || `${COINBASE_BUNDLER_URL}/${config.apiKey}`),
    chain: base,
    paymaster: true, // Enable paymaster sponsorship
    paymasterContext: {
      transport: http(config.paymasterUrl || `${COINBASE_PAYMASTER_URL}/${config.apiKey}`)
    }
  });
  
  return {
    address: account.address,
    client: bundlerClient,
    account,
    signer,
  };
}

/**
 * Gets the counterfactual address for a smart wallet without deploying it
 */
export async function getSmartWalletAddress(
  signerAddress: Address,
  config: SmartWalletConfig
): Promise<Address> {
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.bundlerUrl || `${COINBASE_BUNDLER_URL}/${config.apiKey}`)
  });
  
  // Create a temporary account with the signer address
  // We need to use the actual signer to get the correct smart wallet address
  const tempAccount = {
    address: signerAddress,
    type: 'json-rpc' as const,
    signMessage: async () => '0x' as `0x${string}`,
    signTypedData: async () => '0x' as `0x${string}`,
    signTransaction: async () => '0x' as `0x${string}`,
  };
  
  const smartAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [tempAccount as any],
    version: '1'
  });
  
  return smartAccount.address;
}