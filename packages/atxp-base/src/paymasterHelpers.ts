import { 
  http, 
  createPublicClient,
  type Address,
  type WalletClient,
} from 'viem';
import { base } from 'viem/chains';
import { 
  toCoinbaseSmartAccount,
  createBundlerClient,
  createPaymasterClient,
  type BundlerClient,
  type SmartAccount,
  type PaymasterClient
} from 'viem/account-abstraction';

// Coinbase CDP endpoints
const COINBASE_BUNDLER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';
const COINBASE_PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';

export interface PaymasterSmartWallet {
  address: Address;
  bundlerClient: BundlerClient;
  paymasterClient: PaymasterClient;
  account: SmartAccount;
}

/**
 * Creates a smart wallet with paymaster support for sponsored transactions
 * @param walletClient - The wallet client with the account that will own the smart wallet
 * @param apiKey - Coinbase CDP API key for paymaster services
 * @returns PaymasterSmartWallet with bundler and paymaster clients configured
 */
export async function createPaymasterSmartWallet(
  walletClient: WalletClient,
  apiKey: string
): Promise<PaymasterSmartWallet> {
  if (!walletClient.account) {
    throw new Error('Wallet client must have an account');
  }

  const publicClient = createPublicClient({
    chain: base,
    transport: http(`${COINBASE_BUNDLER_URL}/${apiKey}`)
  });
  
  // Create the Coinbase smart wallet
  const account = await toCoinbaseSmartAccount({
    client: publicClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    owners: [walletClient.account as any], // Type mismatch between viem Account types
    version: '1',
  });
  
  // Create paymaster client
  const paymasterClient = createPaymasterClient({
    transport: http(`${COINBASE_PAYMASTER_URL}/${apiKey}`)
  });
  
  // Create bundler client with paymaster support
  const bundlerClient = createBundlerClient({
    account,
    client: publicClient,
    transport: http(`${COINBASE_BUNDLER_URL}/${apiKey}`),
    chain: base,
    paymaster: paymasterClient,
  });
  
  return {
    address: account.address,
    bundlerClient,
    paymasterClient,
    account,
  };
}

