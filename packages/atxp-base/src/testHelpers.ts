import { vi } from 'vitest';
import type { SpendPermission } from './types.js';
import type { EphemeralSmartWallet } from './smartWalletHelpers.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import type { Address, Hex } from 'viem';

// Common test constants
export const TEST_API_KEY = 'test-api-key';
export const TEST_WALLET_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;
export const TEST_SMART_WALLET_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
export const TEST_RECEIVER_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;
export const TEST_PRIVATE_KEY = generatePrivateKey();
export const TEST_PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base/snPdXqIzOGhRkGNJvEHM5bl9Hm3yRO3m';
export const TEST_BUNDLER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';

// Mock provider
export function mockProvider({
  request = vi.fn()
} = {}) {
  return {
    request
  };
}

// Mock SDK
export function mockBaseAccountSDK({
  provider = mockProvider()
} = {}) {
  return {
    getProvider: vi.fn(() => provider)
  };
}

// Mock spend permission
export function mockSpendPermission({
  signature = '0xmocksignature' as Hex,
  account = TEST_WALLET_ADDRESS,
  spender = TEST_SMART_WALLET_ADDRESS,
  token = USDC_CONTRACT_ADDRESS_BASE,
  allowance = '10000000', // 10 USDC
  period = 604800, // 7 days
  start = Math.floor(Date.now() / 1000),
  end = Math.floor(Date.now() / 1000) + 604800,
  salt = '1',
  extraData = '0x' as Hex,
  chainId = base.id
} = {}): SpendPermission {
  return {
    signature,
    permission: {
      account,
      spender,
      token,
      allowance,
      period,
      start,
      end,
      salt,
      extraData,
      chainId
    }
  } as any;
}

// Mock expired spend permission
export function mockExpiredSpendPermission(overrides = {}): SpendPermission {
  const now = Math.floor(Date.now() / 1000);
  return mockSpendPermission({
    start: now - 1000000,
    end: now - 1000, // Expired
    ...overrides
  });
}

// Mock smart account
export function mockSmartAccount({
  address = TEST_SMART_WALLET_ADDRESS,
  signMessage = vi.fn().mockResolvedValue('0xmocksignature')
} = {}) {
  return {
    address,
    signMessage
  } as any;
}

// Mock bundler client
export function mockBundlerClient({
  sendUserOperation = vi.fn().mockResolvedValue('0xoperationhash'),
  waitForUserOperationReceipt = vi.fn().mockResolvedValue({
    success: true,
    userOpHash: '0xoperationhash',
    receipt: { transactionHash: '0xtxhash' }
  }),
  waitForTransactionReceipt = vi.fn().mockResolvedValue({})
} = {}) {
  return {
    sendUserOperation,
    waitForUserOperationReceipt,
    account: {
      client: {
        waitForTransactionReceipt
      }
    }
  } as any;
}

// Mock failed bundler client
export function mockFailedBundlerClient({
  failureType = 'receipt'
} = {}) {
  if (failureType === 'receipt') {
    return mockBundlerClient({
      waitForUserOperationReceipt: vi.fn().mockResolvedValue(null)
    });
  } else if (failureType === 'deployment') {
    return mockBundlerClient({
      waitForUserOperationReceipt: vi.fn().mockResolvedValue({
        success: false,
        receipt: { transactionHash: '0xtxhash' }
      })
    });
  } else if (failureType === 'noTxHash') {
    return mockBundlerClient({
      waitForUserOperationReceipt: vi.fn().mockResolvedValue({
        success: true,
        userOpHash: '0xoperationhash',
        receipt: {} // No transactionHash
      })
    });
  }
  return mockBundlerClient();
}

// Mock ephemeral smart wallet
export function mockEphemeralSmartWallet({
  address = TEST_SMART_WALLET_ADDRESS,
  account = mockSmartAccount({ address }),
  client = mockBundlerClient(),
  privateKey = TEST_PRIVATE_KEY
} = {}): EphemeralSmartWallet {
  const signer = privateKeyToAccount(privateKey);
  
  return {
    address,
    account,
    client,
    signer: {
      ...signer,
      signMessage: vi.fn().mockResolvedValue('0xmocksignature'),
      signTypedData: vi.fn().mockResolvedValue('0xmocksignature'),
      signTransaction: vi.fn().mockResolvedValue('0xmocksignature'),
      getAddress: vi.fn().mockResolvedValue(address)
    } as any
  };
}

// Mock spend permission calls for payment
export function mockSpendCalls({
  calls = [
    { to: '0xcontract1', data: '0xdata1', value: '0x0' },
    { to: '0xcontract2', data: '0xdata2', value: '0x0' }
  ]
} = {}) {
  return calls;
}



// Helper to setup initialization mocks
export async function setupInitializationMocks({
  provider = mockProvider(),
  spendPermission = mockSpendPermission(),
  smartAccount = mockSmartAccount(),
  bundlerClient = mockBundlerClient()
} = {}): Promise<any> {
  const { createBaseAccountSDK } = await import('@base-org/account');
  const { requestSpendPermission } = await import('@base-org/account/spend-permission');
  const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
  const { createPublicClient } = await import('viem');

  const sdk = mockBaseAccountSDK({ provider });
  
  (createBaseAccountSDK as any).mockReturnValue(sdk);
  (createPublicClient as any).mockReturnValue({});
  (toCoinbaseSmartAccount as any).mockResolvedValue(smartAccount);
  (createBundlerClient as any).mockReturnValue(bundlerClient);
  (requestSpendPermission as any).mockResolvedValue(spendPermission);

  return {
    createBaseAccountSDK,
    requestSpendPermission,
    toCoinbaseSmartAccount,
    createBundlerClient,
    createPublicClient,
    provider,
    sdk
  };
}

// Helper to setup payment mocks
export async function setupPaymentMocks({
  spendCalls = mockSpendCalls()
} = {}): Promise<any> {
  const { prepareSpendCallData } = await import('@base-org/account/spend-permission');
  (prepareSpendCallData as any).mockResolvedValue(spendCalls);
  
  return {
    prepareSpendCallData
  };
}

// Storage key helper
export function getStorageKey(walletAddress: string): string {
  return `atxp-base-permission-${walletAddress}`;
}
