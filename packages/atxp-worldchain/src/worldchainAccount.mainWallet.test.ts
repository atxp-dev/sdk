import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock window object to simulate browser environment
Object.defineProperty(global, 'window', {
  value: {},
  writable: true,
  configurable: true
});

vi.mock('./spendPermissionShim.js', () => ({
  requestSpendPermission: vi.fn(),
  prepareSpendCallData: vi.fn()
}));

vi.mock('./smartWalletHelpers.js', () => ({
  toEphemeralSmartWallet: vi.fn()
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    http: vi.fn(() => 'mock-transport'),
    createPublicClient: vi.fn(() => ({})),
    encodeFunctionData: vi.fn(() => '0xmockencodeddata'),
    createWalletClient: vi.fn(() => ({
      sendTransaction: vi.fn().mockResolvedValue('0xtxhash'),
      getChainId: vi.fn().mockResolvedValue(480) // World Chain mainnet chain ID
    }))
  };
});

import { WorldchainAccount } from './worldchainAccount.js';
import { MemoryCache } from './cache.js';
import {
  TEST_WALLET_ADDRESS,
  mockProvider,
  setupInitializationMocks
} from './testHelpers.js';

describe('WorldchainAccount - Main Wallet Mode', () => {
  let mockCache: MemoryCache;

  beforeEach(() => {
    mockCache = new MemoryCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize with useEphemeralWallet: false', () => {
    it('should create account in main wallet mode', async () => {
      const provider = mockProvider();

      await setupInitializationMocks({
        provider
      });

      // Initialize account in main wallet mode
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache: mockCache
      });

      // Verify account creation
      expect(account).toBeDefined();
      expect(await account.getAccountId()).toBe(`world:${TEST_WALLET_ADDRESS}`); // Uses main wallet address as account ID (qualified with network)
      expect(account.paymentMakers).toBeDefined();
      expect(account.paymentMakers[0]).toBeDefined();

      // Verify wallet_connect was attempted
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });

      // In main wallet mode, no storage should be used for permissions
      // Check if any World Chain specific keys were stored
      const worldStorageKey = `atxp-world-permission-${TEST_WALLET_ADDRESS}`;
      expect(mockCache.get(worldStorageKey)).toBeNull();
    });

    it('should use custom chainId in main wallet mode', async () => {
      const provider = mockProvider();
      const customChainId = 480; // World Chain Mainnet

      await setupInitializationMocks({
        provider
      });

      // Initialize account in main wallet mode with custom chainId
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        chainId: customChainId,
        cache: mockCache
      });

      // Verify account was created with correct payment maker
      expect(account).toBeDefined();
      expect(await account.getAccountId()).toBe(`world:${TEST_WALLET_ADDRESS}`);
      expect(account.paymentMakers[0]).toBeDefined();
    });

    it('should handle wallet_connect failure gracefully in main wallet mode', async () => {
      // Mock provider that fails wallet_connect
      const provider = mockProvider({
        request: vi.fn().mockRejectedValue(new Error('Wallet does not support wallet_connect'))
      });

      await setupInitializationMocks({
        provider
      });

      // Initialize account - should not throw despite wallet_connect failure
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache: mockCache
      });

      // Verify initialization succeeded despite wallet_connect failure
      expect(account).toBeDefined();
      expect(await account.getAccountId()).toBe(`world:${TEST_WALLET_ADDRESS}`);
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
    });

    it('should make payment using main wallet', async () => {
      const provider = mockProvider();

      await setupInitializationMocks({
        provider
      });

      // Initialize account in main wallet mode
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache: mockCache
      });

      // Get the payment maker
      const paymentMaker = account.paymentMakers[0];
      expect(paymentMaker).toBeDefined();

      // Verify it's the MainWalletPaymentMaker (not the WorldchainPaymentMaker)
      // This would be tested more thoroughly in the payment maker specific tests
      expect(paymentMaker.constructor.name).toBe('MainWalletPaymentMaker');
    });
  });

  describe('constructor validation', () => {
    it('should throw when main wallet mode requires address and provider', () => {
      expect(() => {
        new WorldchainAccount(
          null, // No spend permission in main wallet mode
          null, // No ephemeral wallet in main wallet mode
          undefined, // logger
          undefined, // Missing main wallet address
          undefined  // Missing provider
        );
      }).toThrow('Main wallet address and provider are required for main wallet mode');
    });

    it('should throw when ephemeral wallet mode requires spend permission', () => {
      const mockEphemeralWallet = {
        address: TEST_WALLET_ADDRESS,
        account: {},
        client: {},
        signer: {}
      } as any;

      expect(() => {
        new WorldchainAccount(
          null, // Missing spend permission
          mockEphemeralWallet,
          undefined, // logger
          undefined, // No main wallet address in ephemeral mode
          undefined  // No provider in ephemeral mode
        );
      }).toThrow('Spend permission is required for ephemeral wallet mode');
    });
  });
});