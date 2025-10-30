import { vi } from 'vitest';
import type { SpendPermission, Eip1193Provider } from './types.js';
import type { Hex } from 'viem';
import { ICache } from '@atxp/common';

// Custom MemoryCache for tests that handles BigInt serialization
export class TestMemoryCache implements ICache {
  private cache: Map<string, string> = new Map();

  get(key: string): string | null {
    return this.cache.get(key) || null;
  }

  set(key: string, value: string): void {
    // Convert the value, replacing BigInt with strings for storage
    try {
      const parsed = JSON.parse(value);
      const sanitized = JSON.stringify(parsed, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v
      );
      this.cache.set(key, sanitized);
    } catch {
      // If it's not valid JSON, just store it as-is
      this.cache.set(key, value);
    }
  }

  delete(key: string): void {
    this.cache.delete(key);
  }
}

// Helper to serialize objects with BigInt
export function serializeWithBigInt(obj: any): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() + 'n' : value
  );
}

// Helper to deserialize objects with BigInt
export function deserializeWithBigInt(str: string): any {
  return JSON.parse(str, (_, value) => {
    if (typeof value === 'string' && value.endsWith('n')) {
      const numStr = value.slice(0, -1);
      if (/^\d+$/.test(numStr)) {
        return BigInt(numStr);
      }
    }
    return value;
  });
}

// Test constants
export const TEST_WALLET_ADDRESS = '0x1234567890123456789012345678901234567890' as Hex;
export const TEST_SMART_WALLET_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Hex;
export const TEST_RECEIVER_ADDRESS = '0x9876543210987654321098765432109876543210' as Hex;
export const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

// Helper to get cache key
export function getCacheKey(walletAddress: string): string {
  return `atxp-polygon-permission-${walletAddress}`;
}

// Helper to remove timestamp fields for comparison
export function removeTimestamps(obj: any): any {
  const { permission, ...rest } = obj;
  if (permission) {
    const { start, end, ...permRest } = permission;
    return { permission: permRest, ...rest };
  }
  return rest;
}

// Helper to check if timestamp is within reasonable range
export function expectTimestampAround(actual: number, expectedOffset: number, tolerance: number = 10) {
  const now = Math.floor(Date.now() / 1000);
  const expected = now + expectedOffset;
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

// Mock logger
export function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

// Mock spend permission
export function mockSpendPermission(overrides?: Partial<SpendPermission>): SpendPermission {
  const now = Math.floor(Date.now() / 1000);
  return {
    account: TEST_WALLET_ADDRESS,
    spender: TEST_SMART_WALLET_ADDRESS,
    token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as Hex,
    allowance: 10000000n,
    period: 2592000, // 30 days in seconds
    start: now,
    end: now + 2592000,
    salt: '0x1',
    ...overrides
  };
}

// Mock expired spend permission
export function mockExpiredSpendPermission(): SpendPermission {
  const pastTime = Math.floor(Date.now() / 1000) - 100000;
  return {
    account: TEST_WALLET_ADDRESS,
    spender: TEST_SMART_WALLET_ADDRESS,
    token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as Hex,
    allowance: 10000000n,
    period: 2592000,
    start: pastTime,
    end: pastTime + 2592000,
    salt: '0x1'
  };
}

// Mock EIP-1193 provider
export function mockProvider(overrides?: Partial<Eip1193Provider>): Eip1193Provider {
  return {
    request: vi.fn().mockResolvedValue('0xmocksignature'),
    ...overrides
  };
}

// Mock smart account
export function mockSmartAccount(overrides?: any) {
  return {
    address: TEST_SMART_WALLET_ADDRESS,
    signMessage: vi.fn().mockResolvedValue('0xmocksignature'),
    ...overrides
  };
}

// Mock bundler client
export function mockBundlerClient(overrides?: any) {
  return {
    sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
    waitForUserOperationReceipt: vi.fn().mockResolvedValue({
      success: true,
      receipt: {
        transactionHash: '0xtxhash'
      }
    }),
    ...overrides
  };
}

// Mock failed bundler client
export function mockFailedBundlerClient({ failureType }: { failureType: 'deployment' | 'payment' | 'receipt' }) {
  if (failureType === 'deployment') {
    return {
      sendUserOperation: vi.fn().mockRejectedValue(new Error('Smart wallet deployment failed')),
      waitForUserOperationReceipt: vi.fn()
    };
  } else if (failureType === 'receipt') {
    return {
      sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
      waitForUserOperationReceipt: vi.fn().mockRejectedValue(new Error('User operation failed'))
    };
  } else {
    return {
      sendUserOperation: vi.fn().mockRejectedValue(new Error('Payment failed')),
      waitForUserOperationReceipt: vi.fn()
    };
  }
}

// Mock ephemeral smart wallet
export function mockEphemeralSmartWallet(overrides?: { client?: any; account?: any }) {
  const account = overrides?.account || mockSmartAccount();
  const client = overrides?.client || mockBundlerClient();

  return {
    address: TEST_SMART_WALLET_ADDRESS,
    account,
    client
  };
}

// Setup initialization mocks
export async function setupInitializationMocks({
  provider,
  bundlerClient,
  smartAccount,
  ephemeralWallet,
  spendPermission
}: {
  provider?: Eip1193Provider;
  bundlerClient?: any;
  smartAccount?: any;
  ephemeralWallet?: any;
  spendPermission?: SpendPermission;
}) {
  const { requestSpendPermission } = await import('./spendPermissionShim.js');
  const { toEphemeralSmartWallet } = await import('./smartWalletHelpers.js');

  // Setup mocks
  if (spendPermission) {
    (requestSpendPermission as any).mockResolvedValue(spendPermission);
  }

  if (ephemeralWallet) {
    (toEphemeralSmartWallet as any).mockResolvedValue(ephemeralWallet);
  }

  return {
    requestSpendPermission,
    toEphemeralSmartWallet
  };
}

// Setup payment mocks
export async function setupPaymentMocks({ spendCalls }: { spendCalls?: any[] }) {
  const { prepareSpendCallData } = await import('./spendPermissionShim.js');

  if (spendCalls) {
    (prepareSpendCallData as any).mockResolvedValue(spendCalls);
  }

  return {
    prepareSpendCallData
  };
}

// Mock spend calls
export function mockSpendCalls() {
  return [
    { to: '0xcontract1' as Hex, data: '0xdata1' as Hex, value: 0n },
    { to: '0xcontract2' as Hex, data: '0xdata2' as Hex, value: 0n }
  ];
}
