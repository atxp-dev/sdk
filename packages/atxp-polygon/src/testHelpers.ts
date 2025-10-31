import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Eip1193Provider } from './types.js';
import type { Hex } from 'viem';

// Type for mocked provider with vitest mock methods
export type MockEip1193Provider = Eip1193Provider & {
  request: Mock;
};

// Test constants
export const TEST_WALLET_ADDRESS = '0x1234567890123456789012345678901234567890' as Hex;
export const TEST_RECEIVER_ADDRESS = '0x9876543210987654321098765432109876543210' as Hex;
export const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

// Mock logger
export function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

// Mock EIP-1193 provider
export function mockProvider(overrides?: Partial<MockEip1193Provider>): MockEip1193Provider {
  return {
    request: vi.fn().mockResolvedValue('0xmocksignature'),
    ...overrides
  } as MockEip1193Provider;
}
