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
import BigNumber from 'bignumber.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
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

    it('should make correct blockchain calls in main wallet mode', async () => {
      const provider = mockProvider();
      const sdk = mockBaseAccountSDK({ provider });
      
      // @ts-expect-error - mocked function
      createBaseAccountSDK.mockReturnValue(sdk);

      await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'test-app',
        useEphemeralWallet: false,
        storage,
      });

      // Verify SDK initialization
      expect(createBaseAccountSDK).toHaveBeenCalledWith({
        appName: 'test-app',
        appChainIds: [8453], // base.id
        paymasterUrls: {
          8453: 'https://api.developer.coinbase.com/rpc/v1/base/snPdXqIzOGhRkGNJvEHM5bl9Hm3yRO3m'
        }
      });

      // Verify provider setup
      expect(sdk.getProvider).toHaveBeenCalled();
      
      // Verify wallet_connect attempt
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
      
      // Verify NO ephemeral wallet operations
      expect(provider.request).toHaveBeenCalledTimes(1); // Only wallet_connect
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

    it('should pass the provider to MainWalletPaymentMaker', async () => {
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

      // Get the payment maker and verify it has the right properties
      const paymentMaker = account.paymentMakers['base'] as MainWalletPaymentMaker;
      expect(paymentMaker).toBeInstanceOf(MainWalletPaymentMaker);
      
      // Test that the payment maker can use the provider
      await paymentMaker.generateJWT({ paymentRequestId: 'test', codeChallenge: 'test' });
      expect(provider.request).toHaveBeenCalledWith({
        method: 'personal_sign',
        params: expect.any(Array)
      });
    });

    it('should not interact with storage in main wallet mode', async () => {
      const provider = mockProvider();
      const sdk = mockBaseAccountSDK({ provider });
      
      // @ts-expect-error - mocked function
      createBaseAccountSDK.mockReturnValue(sdk);

      // Spy on storage methods
      const getSpy = vi.spyOn(storage, 'get');
      const setSpy = vi.spyOn(storage, 'set');
      const deleteSpy = vi.spyOn(storage, 'delete');

      await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'test-app',
        useEphemeralWallet: false,
        storage,
      });

      // Storage should not be accessed in main wallet mode
      expect(getSpy).not.toHaveBeenCalled();
      expect(setSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
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

  describe('clearAllStoredData in main wallet mode', () => {
    it('should handle clearAllStoredData even though main wallet stores no data', () => {
      const setSpy = vi.spyOn(storage, 'set');
      const deleteSpy = vi.spyOn(storage, 'delete');
      
      // Should not throw
      BaseAppAccount.clearAllStoredData(TEST_WALLET_ADDRESS, storage);
      
      // Should attempt to delete even if nothing was stored
      expect(deleteSpy).toHaveBeenCalledWith(`atxp-base-permission-${TEST_WALLET_ADDRESS}`);
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('payment functionality in main wallet mode', () => {
    it('should make payment using the main wallet', async () => {
      const provider = mockProvider();
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'wallet_connect') return undefined;
        if (method === 'personal_sign') return '0xmocksignature';
        if (method === 'eth_sendTransaction') return '0xtxhash';
        if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x100' };
        if (method === 'eth_blockNumber') return '0x102';
        throw new Error(`Unexpected method: ${method}`);
      });
      
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

      const paymentMaker = account.paymentMakers['base'];
      expect(paymentMaker).toBeDefined();

      // Make a payment
      const txHash = await paymentMaker.makePayment(
        new BigNumber(1.5),
        'USDC',
        '0x1234567890123456789012345678901234567890',
        'Test payment'
      );

      expect(txHash).toBe('0xtxhash');
      
      // Verify eth_sendTransaction was called (it's the 2nd call after wallet_connect)
      expect(provider.request).toHaveBeenCalledWith({
        method: 'eth_sendTransaction',
        params: [{
          from: TEST_WALLET_ADDRESS,
          to: USDC_CONTRACT_ADDRESS_BASE,
          data: expect.any(String),
          value: '0x0'
        }]
      });
    });

    it('should generate JWT for authentication', async () => {
      const provider = mockProvider();
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'wallet_connect') return undefined;
        if (method === 'personal_sign') return '0xmocksignature';
        throw new Error(`Unexpected method: ${method}`);
      });
      
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

      const paymentMaker = account.paymentMakers['base'];
      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // JWT should be base64url encoded
      expect(jwt).toMatch(/^[A-Za-z0-9_-]+$/);
      
      // Verify personal_sign was called
      expect(provider.request).toHaveBeenCalledWith({
        method: 'personal_sign',
        params: [
          expect.stringContaining('PayMCP Authorization Request'),
          TEST_WALLET_ADDRESS
        ]
      });
    });
  });
});