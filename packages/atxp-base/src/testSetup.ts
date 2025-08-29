import { vi } from 'vitest';

// Mock window for Node.js environment
if (typeof window === 'undefined') {
  (global as any).window = {
    localStorage: {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
  };
}

// Mock all external modules before they are imported
vi.mock('@base-org/account', () => ({
  createBaseAccountSDK: vi.fn(() => ({
    getProvider: vi.fn(() => ({
      request: vi.fn()
    }))
  }))
}));

vi.mock('@base-org/account/spend-permission', () => ({
  requestSpendPermission: vi.fn(),
  prepareSpendCallData: vi.fn()
}));

vi.mock('viem/account-abstraction', () => ({
  toCoinbaseSmartAccount: vi.fn(),
  createBundlerClient: vi.fn()
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    http: vi.fn(() => 'mock-transport'),
    createPublicClient: vi.fn(() => ({})),
    encodeFunctionData: vi.fn(() => '0xmockencodeddata')
  };
});
