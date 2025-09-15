import { 
  http, 
  createPublicClient, 
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { 
  toCoinbaseSmartAccount,
  createBundlerClient,
  type BundlerClient,
  type SmartAccount
} from 'viem/account-abstraction';

// Coinbase CDP Paymaster and Bundler endpoints
const COINBASE_BUNDLER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';
const COINBASE_PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';
const COINBASE_API_KEY = 'snPdXqIzOGhRkGNJvEHM5bl9Hm3yRO3m';

export interface EphemeralSmartWallet {
  address: Address;
  client: BundlerClient;
  account: SmartAccount;
  signer: Account;
}

/**
 * Creates an ephemeral smart wallet with paymaster support
 */
export async function toEphemeralSmartWallet(
  privateKey: Hex
): Promise<EphemeralSmartWallet> {
  const apiKey = COINBASE_API_KEY;
  const signer = privateKeyToAccount(privateKey);
  
  const publicClient = createPublicClient({
    chain: base,
    transport: http(`${COINBASE_BUNDLER_URL}/${apiKey}`)
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
    transport: http(`${COINBASE_BUNDLER_URL}/${apiKey}`),
    chain: base,
    paymaster: true, // Enable paymaster sponsorship
    paymasterContext: {
      transport: http(`${COINBASE_PAYMASTER_URL}/${apiKey}`)
    }
  });
  
  return {
    address: account.address,
    client: bundlerClient,
    account,
    signer,
  };
}