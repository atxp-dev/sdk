/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, expect } from 'vitest';
import type { SpendPermission } from './types.js';
import type { EphemeralSmartWallet } from './smartWalletHelpers.js';
import { WorldchainPaymentMaker, type ConfirmationDelays, type WorldchainPaymentMakerOptions } from './worldchainPaymentMaker.js';
import { USDC_CONTRACT_ADDRESS_WORLD_MAINNET, WORLD_CHAIN_MAINNET } from '@atxp/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

// Common test constants
export const TEST_WALLET_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;
export const TEST_SMART_WALLET_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
export const TEST_RECEIVER_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;
export const TEST_PRIVATE_KEY = generatePrivateKey();
export const TEST_PAYMASTER_URL = 'https://worldchain-bundler.example.com';
export const TEST_BUNDLER_URL = 'https://worldchain-bundler.example.com';

// Test confirmation delays (much shorter for tests)
export const TEST_CONFIRMATION_DELAYS: ConfirmationDelays = {
  networkPropagationMs: 10, // 10ms instead of 5 seconds
  confirmationFailedMs: 20  // 20ms instead of 15 seconds
};

// Mock provider
export function mockProvider({
  request = vi.fn()
} = {}) {
  return {
    request
  };
}

// Mock spend permission
export function mockSpendPermission({
  signature = '0xmocksignature' as Hex,
  account = TEST_WALLET_ADDRESS,
  spender = TEST_SMART_WALLET_ADDRESS,
  token = USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
  allowance = '10000000', // 10 USDC
  period = 604800, // 7 days
  start = Math.floor(Date.now() / 1000),
  end = Math.floor(Date.now() / 1000) + 604800,
  salt = '1',
  extraData = '0x' as Hex,
  chainId = WORLD_CHAIN_MAINNET.id
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

// Helper to remove timestamp fields from any object (for test comparisons)
export function removeTimestamps<T extends Record<string, any>>(obj: T): T {
  // Common timestamp field names
  const timestampFields = ['timestamp', 'start', 'end', 'createdAt', 'updatedAt', 'expiresAt', 'issuedAt'];

  // Deep clone the object to avoid mutations
  const result = JSON.parse(JSON.stringify(obj));

  // Recursive function to remove timestamps
  function removeFromObject(target: any): void {
    if (!target || typeof target !== 'object') return;

    // Handle arrays
    if (Array.isArray(target)) {
      target.forEach(item => removeFromObject(item));
      return;
    }

    // Handle objects
    for (const key in target) {
      if (timestampFields.includes(key)) {
        // Validate it looks like a timestamp (number between year 2000 and 2100)
        const value = target[key];
        if (typeof value === 'number' && value > 946684800 && value < 4102444800) {
          delete target[key];
        }
      } else if (typeof target[key] === 'object') {
        removeFromObject(target[key]);
      }
    }
  }

  removeFromObject(result);
  return result;
}

// Helper to check if a timestamp is within a certain range of an expected time
// This uses toBeGreaterThanOrEqual/toBeLessThanOrEqual because toBeCloseTo is for
// floating-point precision, not range checking
export function expectTimestampAround(timestamp: number, expectedOffset: number = 0, tolerance: number = 60) {
  const now = Math.floor(Date.now() / 1000);
  const expected = now + expectedOffset;
  expect(timestamp).toBeGreaterThanOrEqual(expected - tolerance);
  expect(timestamp).toBeLessThanOrEqual(expected + tolerance);
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

/**
 * Helper to create a WorldchainPaymentMaker for testing with fast confirmation delays
 *
 * @param permission - Spend permission (defaults to mock)
 * @param smartWallet - Smart wallet (defaults to mock)
 * @param options - Additional options
 * @returns WorldchainPaymentMaker configured for testing
 */
export function createTestWorldchainPaymentMaker(
  permission: SpendPermission = mockSpendPermission(),
  smartWallet: EphemeralSmartWallet = mockEphemeralSmartWallet(),
  options: Partial<WorldchainPaymentMakerOptions> = {}
): WorldchainPaymentMaker {
  const testOptions: WorldchainPaymentMakerOptions = {
    confirmationDelays: TEST_CONFIRMATION_DELAYS,
    ...options
  };

  return new WorldchainPaymentMaker(permission, smartWallet, testOptions);
}

/**
 * Builder pattern for creating test payment makers with fluent API
 */
export class TestWorldchainPaymentMakerBuilder {
  private permission?: SpendPermission;
  private smartWallet?: EphemeralSmartWallet;
  private options: WorldchainPaymentMakerOptions = {};

  withPermission(permission: SpendPermission) {
    this.permission = permission;
    return this;
  }

  withSmartWallet(wallet: EphemeralSmartWallet) {
    this.smartWallet = wallet;
    return this;
  }

  withTestDelays(delays?: ConfirmationDelays) {
    this.options.confirmationDelays = delays ?? TEST_CONFIRMATION_DELAYS;
    return this;
  }

  withChainId(chainId: number) {
    this.options.chainId = chainId;
    return this;
  }

  withCustomRpc(rpcUrl: string) {
    this.options.customRpcUrl = rpcUrl;
    return this;
  }

  build(): WorldchainPaymentMaker {
    return createTestWorldchainPaymentMaker(
      this.permission,
      this.smartWallet,
      this.options
    );
  }
}

// Helper to setup initialization mocks
export async function setupInitializationMocks({
  provider = mockProvider(),
  smartAccount = mockSmartAccount(),
  bundlerClient = mockBundlerClient(),
  spendPermission = mockSpendPermission(),
  ephemeralWallet = mockEphemeralSmartWallet()
} = {}): Promise<any> {
  const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
  const { createPublicClient } = await import('viem');
  const { requestSpendPermission } = await import('./spendPermissionShim.js');
  const { toEphemeralSmartWallet } = await import('./smartWalletHelpers.js');

  // Ensure mocks are properly initialized
  if (createPublicClient && typeof (createPublicClient as any).mockReturnValue === 'function') {
    (createPublicClient as any).mockReturnValue({});
  }
  if (toCoinbaseSmartAccount && typeof (toCoinbaseSmartAccount as any).mockResolvedValue === 'function') {
    (toCoinbaseSmartAccount as any).mockResolvedValue(smartAccount);
  }
  if (createBundlerClient && typeof (createBundlerClient as any).mockReturnValue === 'function') {
    (createBundlerClient as any).mockReturnValue(bundlerClient);
  }
  if (requestSpendPermission && typeof (requestSpendPermission as any).mockResolvedValue === 'function') {
    (requestSpendPermission as any).mockResolvedValue(spendPermission);
  }
  if (toEphemeralSmartWallet && typeof (toEphemeralSmartWallet as any).mockResolvedValue === 'function') {
    (toEphemeralSmartWallet as any).mockResolvedValue(ephemeralWallet);
  }

  return {
    toCoinbaseSmartAccount,
    createBundlerClient,
    createPublicClient,
    requestSpendPermission,
    toEphemeralSmartWallet,
    provider,
  };
}

// Helper to setup payment mocks
export async function setupPaymentMocks({
  spendCalls = mockSpendCalls()
} = {}): Promise<any> {
  const { prepareSpendCallData } = await import('./spendPermissionShim.js');

  (prepareSpendCallData as any).mockResolvedValue(spendCalls);

  return {
    prepareSpendCallData
  };
}

// Storage key helper
export function getStorageKey(walletAddress: string): string {
  return `atxp-world-permission-${walletAddress}`;
}