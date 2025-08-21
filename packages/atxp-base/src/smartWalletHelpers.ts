import { 
  createSmartAccountClient,
  type SmartAccountClient,
} from 'permissionless';
import { 
  toSimpleSmartAccount,
} from 'permissionless/accounts';
import { 
  createPimlicoClient,
} from 'permissionless/clients/pimlico';
import { 
  http, 
  createPublicClient, 
  type Account,
  type Address,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Coinbase CDP Paymaster and Bundler endpoints
const COINBASE_BUNDLER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';
const COINBASE_PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';
const ENTRYPOINT_ADDRESS_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;

export interface SmartWalletConfig {
  apiKey: string;
  paymasterUrl?: string;
  bundlerUrl?: string;
}

export interface EphemeralSmartWallet {
  address: Address;
  client: SmartAccountClient;
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
  
  // Create the simple account (smart wallet)
  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: signer,
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V07,
      version: '0.7'
    },
  });
  
  // Create pimlico client for paymaster
  const pimlicoClient = createPimlicoClient({
    transport: http(config.paymasterUrl || `${COINBASE_PAYMASTER_URL}/${config.apiKey}`),
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V07,
      version: '0.7'
    },
  });
  
  // Create smart account client with paymaster
  const smartAccountClient = createSmartAccountClient({
    account: simpleAccount,
    chain: base,
    bundlerTransport: http(config.bundlerUrl || `${COINBASE_BUNDLER_URL}/${config.apiKey}`),
    paymaster: pimlicoClient,
  });
  
  return {
    address: simpleAccount.address,
    client: smartAccountClient,
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
  
  // Create a dummy private key to generate a temporary account
  // The actual private key doesn't matter since we only need the address
  const dummyPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
  const dummySigner = privateKeyToAccount(dummyPrivateKey);
  
  // Override the address to match the intended signer
  const tempAccount = {
    ...dummySigner,
    address: signerAddress,
  };
  
  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: tempAccount,
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V07,
      version: '0.7'
    },
  });
  
  return simpleAccount.address;
}