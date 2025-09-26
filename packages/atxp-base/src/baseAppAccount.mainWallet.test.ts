// Mock the ephemeral wallet functions at the top
vi.mock('./spendPermissionShim.js', () => ({
  requestSpendPermission: vi.fn(),
  prepareSpendCallData: vi.fn()
}));

vi.mock('viem/account-abstraction', () => ({
  toCoinbaseSmartAccount: vi.fn(),
  createBundlerClient: vi.fn()
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
      getChainId: vi.fn().mockResolvedValue(8453) // Base mainnet chain ID
    }))
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAppAccount } from './baseAppAccount.js';
import { MainWalletPaymentMaker } from './mainWalletPaymentMaker.js';
import { MemoryCache } from './cache.js';
import BigNumber from 'bignumber.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import {
  TEST_WALLET_ADDRESS,
  mockProvider,
} from './testHelpers.js';

describe('BaseAppAccount - Main Wallet Mode', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new MemoryCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize with useEphemeralWallet=false', () => {
    it('should initialize without creating ephemeral wallet', async () => {
      const provider = mockProvider();

      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache,
      });

      // Should have main wallet address as account ID
      expect(account.accountId).toBe(TEST_WALLET_ADDRESS);
      
      // Should have main wallet payment maker
      expect(account.paymentMakers['base']).toBeInstanceOf(MainWalletPaymentMaker);
      
      // Should still connect wallet
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
      
      // Should NOT create ephemeral wallet or request spend permission
      // Storage should remain empty (no ephemeral wallet data saved)
      const cacheKey = `atxp-base-permission-${TEST_WALLET_ADDRESS}`;
      expect(cache.get(cacheKey)).toBeNull();
    });

    it('should make correct blockchain calls in main wallet mode', async () => {
      const provider = mockProvider();

      await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache,
      });
      
      // Verify wallet_connect attempt
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
      
      // Verify NO ephemeral wallet operations
      expect(provider.request).toHaveBeenCalledTimes(1); // Only wallet_connect
    });

    it('should handle wallet_connect failure gracefully', async () => {
      const provider = mockProvider();
      provider.request.mockRejectedValueOnce(new Error('wallet_connect not supported'));

      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache,
      });

      expect(account.accountId).toBe(TEST_WALLET_ADDRESS);
      expect(account.paymentMakers['base']).toBeInstanceOf(MainWalletPaymentMaker);
    });

    it('should pass the provider to MainWalletPaymentMaker', async () => {
      const provider = mockProvider();
      // Set up mock to return signature for personal_sign
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'personal_sign') return '0xmocksignature';
        throw new Error(`Unexpected method: ${method}`);
      });

      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache,
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

    it('should not interact with cache in main wallet mode', async () => {
      const provider = mockProvider();

      // Spy on cache methods
      const getSpy = vi.spyOn(cache, 'get');
      const setSpy = vi.spyOn(cache, 'set');
      const deleteSpy = vi.spyOn(cache, 'delete');

      await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache,
      });

      // Storage should not be accessed in main wallet mode
      expect(getSpy).not.toHaveBeenCalled();
      expect(setSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('initialize with useEphemeralWallet not specified', () => {
    it('should default to ephemeral wallet mode for backward compatibility', async () => {
      // Need to add ephemeral wallet mocks for this test
      const { setupInitializationMocks } = await import('./testHelpers.js');

      const provider = mockProvider();
      await setupInitializationMocks({ provider });

      // This should work in ephemeral wallet mode (the default)
      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache,
        // useEphemeralWallet not specified - should default to true
      });

      // Should be in ephemeral wallet mode with smart wallet address as accountId
      expect(account).toBeDefined();
      expect(account.paymentMakers['base']).toBeDefined();
      // In ephemeral mode, we expect the account ID to be different from wallet address
      expect(account.accountId).not.toBe(TEST_WALLET_ADDRESS);
    });
  });

  describe('clearAllStoredData in main wallet mode', () => {
    it('should handle clearAllStoredData even though main wallet stores no data', () => {
      const setSpy = vi.spyOn(cache, 'set');
      const deleteSpy = vi.spyOn(cache, 'delete');
      
      // Should not throw
      BaseAppAccount.clearAllCachedData(TEST_WALLET_ADDRESS, cache);
      
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

      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache,
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

      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        cache,
      });

      const paymentMaker = account.paymentMakers['base'];
      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // JWT should have proper JWT format (header.payload.signature)
      expect(jwt.split('.')).toHaveLength(3);
      
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