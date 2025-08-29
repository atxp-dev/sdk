// Mock all external modules before imports
vi.mock('@base-org/account', () => ({
  createBaseAccountSDK: vi.fn(() => ({
    getProvider: vi.fn(() => ({
      request: vi.fn()
    }))
  }))
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAppAccount } from './baseAppAccount.js';
import { MainWalletPaymentMaker } from './mainWalletPaymentMaker.js';
import { MemoryStorage } from './storage.js';
import { 
  TEST_API_KEY,
  TEST_WALLET_ADDRESS,
  mockProvider,
  mockBaseAccountSDK,
} from './testHelpers.js';

const { createBaseAccountSDK } = await import('@base-org/account');

describe('BaseAppAccount - Main Wallet Mode', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new MemoryStorage();
    // Don't call setupInitializationMocks as it tries to mock functions we haven't declared
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize with useEphemeralWallet=false', () => {
    it('should initialize without creating ephemeral wallet', async () => {
      const provider = mockProvider();
      const sdk = mockBaseAccountSDK({ provider });
      
      // @ts-expect-error - mocked function
      createBaseAccountSDK.mockReturnValue(sdk);

      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'test-app',
        useEphemeralWallet: false,
        storage,
      });

      // Should have main wallet address as account ID
      expect(account.accountId).toBe(TEST_WALLET_ADDRESS);
      
      // Should have main wallet payment maker
      expect(account.paymentMakers['base']).toBeInstanceOf(MainWalletPaymentMaker);
      
      // Should still connect wallet
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
      
      // Should NOT create ephemeral wallet or request spend permission
      expect(createBaseAccountSDK).toHaveBeenCalledTimes(1);
      // Storage should remain empty (no ephemeral wallet data saved)
      const storageKey = `atxp-base-permission-${TEST_WALLET_ADDRESS}`;
      expect(storage.get(storageKey)).toBeNull();
    });

    it('should handle wallet_connect failure gracefully', async () => {
      const provider = mockProvider();
      provider.request.mockRejectedValueOnce(new Error('wallet_connect not supported'));
      
      const sdk = mockBaseAccountSDK({ provider });
      
      // @ts-expect-error - mocked function
      createBaseAccountSDK.mockReturnValue(sdk);

      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'test-app',
        useEphemeralWallet: false,
        storage,
      });

      expect(account.accountId).toBe(TEST_WALLET_ADDRESS);
      expect(account.paymentMakers['base']).toBeInstanceOf(MainWalletPaymentMaker);
    });

    it('should not require apiKey in main wallet mode', async () => {
      const provider = mockProvider();
      const sdk = mockBaseAccountSDK({ provider });
      
      // @ts-expect-error - mocked function
      createBaseAccountSDK.mockReturnValue(sdk);

      // Should not throw without API key when useEphemeralWallet=false
      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: '', // Empty API key
        appName: 'test-app',
        useEphemeralWallet: false,
        storage,
      });

      expect(account.accountId).toBe(TEST_WALLET_ADDRESS);
    });
  });

  describe('initialize with useEphemeralWallet not specified', () => {
    it('should default to ephemeral wallet mode for backward compatibility', async () => {
      const provider = mockProvider();
      const sdk = mockBaseAccountSDK({ provider });
      
      // @ts-expect-error - mocked function
      createBaseAccountSDK.mockReturnValue(sdk);

      // This should throw because apiKey is required for ephemeral wallet mode
      await expect(
        BaseAppAccount.initialize({
          walletAddress: TEST_WALLET_ADDRESS,
          apiKey: '', // Empty API key
          appName: 'test-app',
          storage,
          // useEphemeralWallet not specified - should default to true
        })
      ).rejects.toThrow('Smart wallet API key is required for ephemeral wallet mode');
    });
  });
});
