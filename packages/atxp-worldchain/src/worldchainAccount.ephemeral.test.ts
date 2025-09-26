import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock window object to simulate browser environment for ephemeral wallet tests
Object.defineProperty(global, 'window', {
  value: {},
  writable: true,
  configurable: true
});

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
      getChainId: vi.fn().mockResolvedValue(480) // World Chain mainnet chain ID
    }))
  };
});

import { WorldchainAccount } from './worldchainAccount.js';
import { MemoryCache } from './cache.js';
import { WORLD_CHAIN_MAINNET, USDC_CONTRACT_ADDRESS_WORLD_MAINNET } from '@atxp/client';
import BigNumber from 'bignumber.js';
import {
  TEST_WALLET_ADDRESS,
  TEST_SMART_WALLET_ADDRESS,
  TEST_RECEIVER_ADDRESS,
  TEST_PRIVATE_KEY,
  setupInitializationMocks,
  setupPaymentMocks,
  mockSpendPermission,
  mockExpiredSpendPermission,
  mockSmartAccount,
  mockBundlerClient,
  mockFailedBundlerClient,
  mockProvider,
  mockSpendCalls,
  mockEphemeralSmartWallet,
  getCacheKey,
  removeTimestamps,
  expectTimestampAround,
  createTestWorldchainPaymentMaker
} from './testHelpers.js';

describe('WorldchainAccount', () => {
  let mockCache: MemoryCache;

  beforeEach(() => {
    mockCache = new MemoryCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should create a new account when no stored data exists', async () => {
      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });
      const permission = mockSpendPermission();

      const mocks = await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: permission
      });

      // Initialize account
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      });

      // Verify account creation
      expect(account).toBeDefined();
      expect(account.accountId).toBe(TEST_SMART_WALLET_ADDRESS);
      expect(account.paymentMakers).toBeDefined();
      expect(account.paymentMakers.world).toBeDefined();

      // Verify mocks were called
      expect(mocks.toEphemeralSmartWallet).toHaveBeenCalled();
      expect(mocks.requestSpendPermission).toHaveBeenCalledWith({
        account: TEST_WALLET_ADDRESS,
        spender: TEST_SMART_WALLET_ADDRESS,
        token: USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
        chainId: WORLD_CHAIN_MAINNET.id,
        allowance: 10n,
        periodInDays: 7,
        provider: provider
      });

      // Verify smart wallet was deployed (no paymaster for World Chain initially)
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        calls: [{
          to: TEST_SMART_WALLET_ADDRESS,
          value: 0n,
          data: '0x'
        }]
        // Note: paymaster omitted for World Chain
      });

      // Verify data was stored
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);
      const storedData = mockCache.get(cacheKey);
      expect(storedData).toBeTruthy();
      const parsedData = JSON.parse(storedData!);
      expect(parsedData.privateKey).toBeDefined();
      expect(parsedData.permission).toBeDefined();
    });

    it('should reuse existing account when valid stored data exists', async () => {
      // Pre-store valid permission
      const permission = mockSpendPermission();
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);
      mockCache.set(cacheKey, JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        permission
      }));

      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      const mocks = await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: permission
      });

      // Initialize account
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      });

      // Verify account was loaded from storage
      expect(account).toBeDefined();
      expect(account.accountId).toBe(TEST_SMART_WALLET_ADDRESS);

      // Verify smart wallet was NOT deployed (reusing existing)
      expect(bundlerClient.sendUserOperation).not.toHaveBeenCalled();
      expect(mocks.requestSpendPermission).not.toHaveBeenCalled();
    });

    it('should create new account when stored permission is expired', async () => {
      // Pre-store expired permission
      const expiredPermission = mockExpiredSpendPermission();
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);
      mockCache.set(cacheKey, JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        permission: expiredPermission
      }));

      const newPermission = mockSpendPermission({ salt: '2', signature: '0xnewsignature' });
      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      const mocks = await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: newPermission
      });

      // Initialize account
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      });

      // Verify new account was created
      expect(account).toBeDefined();
      expect(bundlerClient.sendUserOperation).toHaveBeenCalled();
      expect(mocks.requestSpendPermission).toHaveBeenCalled();

      // Verify old data was removed and new data stored
      const storedData = mockCache.get(cacheKey);
      expect(storedData).toBeTruthy();
      const parsedData = JSON.parse(storedData!);
      expect(parsedData.permission).toMatchObject(removeTimestamps(newPermission));

      // Verify timestamps are reasonable
      expectTimestampAround(parsedData.permission.permission.start, 0);
      expectTimestampAround(parsedData.permission.permission.end, 604800);
    });

    it('should use custom allowance and period when provided', async () => {
      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });
      const permission = mockSpendPermission();

      const mocks = await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: permission
      });

      // Initialize with custom values
      const customAllowance = 100n;
      const customPeriod = 30;

      await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        allowance: customAllowance,
        periodInDays: customPeriod,
        cache: mockCache
      });

      // Verify custom values were used
      expect(mocks.requestSpendPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          allowance: customAllowance,
          periodInDays: customPeriod
        })
      );
    });


    it('should make all required blockchain calls when creating new account', async () => {
      const provider = mockProvider();
      const bundlerClient = mockBundlerClient();
      const smartAccount = mockSmartAccount();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient, account: smartAccount });
      const permission = mockSpendPermission();

      const mocks = await setupInitializationMocks({
        provider,
        bundlerClient,
        smartAccount,
        ephemeralWallet,
        spendPermission: permission
      });

      // Initialize account
      await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      });

      // Verify wallet_connect attempt
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });

      // Verify smart wallet deployment (without paymaster for World Chain)
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledTimes(1);
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        calls: [{
          to: TEST_SMART_WALLET_ADDRESS,
          value: 0n,
          data: '0x'
        }]
        // Note: no paymaster for World Chain
      });
      expect(bundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({
        hash: '0xoperationhash'
      });

      // Verify spend permission request
      expect(mocks.requestSpendPermission).toHaveBeenCalledTimes(1);
      expect(mocks.requestSpendPermission).toHaveBeenCalledWith({
        account: TEST_WALLET_ADDRESS,
        spender: TEST_SMART_WALLET_ADDRESS,
        token: USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
        chainId: WORLD_CHAIN_MAINNET.id,
        allowance: 10n,
        periodInDays: 7,
        provider: provider
      });
    });

    it('should skip deployment and permission when reusing stored account', async () => {
      // Pre-store valid permission
      const permission = mockSpendPermission();
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);
      mockCache.set(cacheKey, JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        permission
      }));

      const provider = mockProvider();
      const bundlerClient = mockBundlerClient();
      const smartAccount = mockSmartAccount();

      const mocks = await setupInitializationMocks({
        provider,
        bundlerClient,
        smartAccount
      });

      // Initialize account
      await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      });

      // Verify wallet_connect attempt still happens
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });

      // Verify NO smart wallet deployment
      expect(bundlerClient.sendUserOperation).not.toHaveBeenCalled();
      expect(bundlerClient.waitForUserOperationReceipt).not.toHaveBeenCalled();

      // Verify NO new spend permission request
      expect(mocks.requestSpendPermission).not.toHaveBeenCalled();
    });

    it('should handle wallet_connect failure gracefully', async () => {
      // Mock provider that fails wallet_connect
      const provider = mockProvider({
        request: vi.fn().mockRejectedValue(new Error('Wallet does not support wallet_connect'))
      });

      const bundlerClient = mockBundlerClient();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });
      const permission = mockSpendPermission();

      const mocks = await setupInitializationMocks({
        provider,
        bundlerClient,
        ephemeralWallet,
        spendPermission: permission
      });

      // Initialize account - should not throw despite wallet_connect failure
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      });

      // Verify initialization continued despite wallet_connect failure
      expect(account).toBeDefined();
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
      expect(bundlerClient.sendUserOperation).toHaveBeenCalled();
      expect(mocks.requestSpendPermission).toHaveBeenCalled();
    });

    it('should throw when smart wallet deployment fails', async () => {
      const bundlerClient = mockFailedBundlerClient({ failureType: 'deployment' });
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });
      const permission = mockSpendPermission();

      await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: permission
      });

      // Initialize should throw
      await expect(WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      })).rejects.toThrow('Smart wallet deployment failed');
    });
  });

  describe('clearAllCachedData', () => {
    it('should remove stored data for the given wallet address', () => {
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);

      // Store some data
      mockCache.set(cacheKey, 'test-data');
      expect(mockCache.get(cacheKey)).toBe('test-data');

      // Clear the data
      WorldchainAccount.clearAllCachedData(TEST_WALLET_ADDRESS, mockCache);

      // Verify data was removed
      expect(mockCache.get(cacheKey)).toBeNull();
    });

    it('should throw error when called outside browser without storage', () => {
      // Mock window as undefined (non-browser environment)
      const originalWindow = global.window;
      (global as any).window = undefined;

      expect(() => {
        WorldchainAccount.clearAllCachedData(TEST_WALLET_ADDRESS);
      }).toThrow('clearAllCachedData requires a storage to be provided outside of browser environments');

      // Restore window
      (global as any).window = originalWindow;
    });
  });

  describe('payment functionality', () => {
    it('should make payment using the ephemeral wallet', async () => {
      // Pre-store valid data
      const permission = mockSpendPermission();
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);
      mockCache.set(cacheKey, JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        permission
      }));

      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });
      const spendCalls = mockSpendCalls();

      await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: permission
      });

      const { prepareSpendCallData } = await setupPaymentMocks({ spendCalls });

      // Initialize account
      const account = await WorldchainAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        cache: mockCache
      });

      // Replace the payment maker with a test version that has short delays
      const testPaymentMaker = createTestWorldchainPaymentMaker(permission, ephemeralWallet);
      account.paymentMakers.world = testPaymentMaker;

      // Make a payment
      const paymentMaker = account.paymentMakers.world;
      const amount = new BigNumber(1.5); // 1.5 USDC
      const txHash = await paymentMaker.makePayment(amount, 'USDC', TEST_RECEIVER_ADDRESS, 'test payment');

      // Verify payment was made
      expect(txHash).toBe('0xtxhash');
      expect(prepareSpendCallData).toHaveBeenCalledWith({ permission, amount: 1500000n }); // 1.5 USDC in smallest units
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        account: ephemeralWallet.account,
        calls: expect.arrayContaining([
          { to: '0xcontract1', data: '0xdata1', value: 0n },
          { to: '0xcontract2', data: '0xdata2', value: 0n },
          expect.objectContaining({
            to: USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
            data: expect.any(String), // Contains encoded memo
            value: 0n
          })
        ]),
        maxPriorityFeePerGas: expect.any(BigInt)
      });
    });
  });
});