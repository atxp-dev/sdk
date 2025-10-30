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
      getChainId: vi.fn().mockResolvedValue(137) // Polygon mainnet chain ID
    }))
  };
});

import { PolygonAccount } from './polygonAccount.js';
import { getPolygonUSDCAddress } from '@atxp/client';
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
  mockBundlerClient,
  mockFailedBundlerClient,
  mockProvider,
  mockSpendCalls,
  mockEphemeralSmartWallet,
  getCacheKey,
  removeTimestamps,
  expectTimestampAround,
  TestMemoryCache,
  serializeWithBigInt
} from './testHelpers.js';

describe('PolygonAccount', () => {
  let mockCache: TestMemoryCache;

  beforeEach(() => {
    mockCache = new TestMemoryCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize with ephemeral wallet', () => {
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

      const now = Math.floor(Date.now() / 1000);

      // Initialize account
      const account = await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: true,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
        cache: mockCache
      });

      // Verify account creation
      expect(account).toBeDefined();
      expect(account.accountId).toBe(`polygon:${TEST_SMART_WALLET_ADDRESS}`);
      expect(account.paymentMakers).toBeDefined();
      expect(account.paymentMakers).toHaveLength(1);

      // Verify mocks were called
      expect(mocks.toEphemeralSmartWallet).toHaveBeenCalled();
      expect(mocks.requestSpendPermission).toHaveBeenCalledWith({
        provider,
        spender: TEST_SMART_WALLET_ADDRESS,
        token: getPolygonUSDCAddress(137),
        amount: BigInt('10000000'),
        start: now,
        end: now + 30 * 24 * 60 * 60,
        period: 30 * 24 * 60 * 60
      });

      // Verify smart wallet was deployed
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        calls: [{
          to: TEST_SMART_WALLET_ADDRESS,
          value: 0n,
          data: '0x'
        }],
        paymaster: true
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
      mockCache.set(
        cacheKey,
        serializeWithBigInt({
          privateKey: TEST_PRIVATE_KEY,
          permission
        })
      );

      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      const mocks = await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: permission
      });

      const now = Math.floor(Date.now() / 1000);

      // Initialize account
      const account = await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: true,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
        cache: mockCache
      });

      // Verify account was loaded from storage
      expect(account).toBeDefined();
      expect(account.accountId).toBe(`polygon:${TEST_SMART_WALLET_ADDRESS}`);

      // Verify smart wallet was NOT deployed (reusing existing)
      expect(bundlerClient.sendUserOperation).not.toHaveBeenCalled();
      expect(mocks.requestSpendPermission).not.toHaveBeenCalled();
    });

    it('should create new account when stored permission is expired', async () => {
      // Pre-store expired permission
      const expiredPermission = mockExpiredSpendPermission();
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);
      mockCache.set(
        cacheKey,
        serializeWithBigInt({
          privateKey: TEST_PRIVATE_KEY,
          permission: expiredPermission
        })
      );

      const newPermission = mockSpendPermission();
      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      const mocks = await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: newPermission
      });

      const now = Math.floor(Date.now() / 1000);

      // Initialize account
      const account = await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: true,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
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

      const now = Math.floor(Date.now() / 1000);

      // Initialize should throw
      await expect(
        PolygonAccount.initialize({
          walletAddress: TEST_WALLET_ADDRESS,
          provider: provider,
          useEphemeralWallet: true,
          allowance: BigInt('10000000'),
          periodInDays: 30,
          periodStart: now,
          cache: mockCache
        })
      ).rejects.toThrow('Smart wallet deployment failed');
    });
  });

  describe('initialize with main wallet', () => {
    it('should create account without ephemeral wallet', async () => {
      const provider = mockProvider();
      const now = Math.floor(Date.now() / 1000);

      // Initialize account in main wallet mode
      const account = await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
        cache: mockCache
      });

      // Verify account creation
      expect(account).toBeDefined();
      expect(account.accountId).toBe(`polygon:${TEST_WALLET_ADDRESS}`);
      expect(account.paymentMakers).toBeDefined();
      expect(account.paymentMakers).toHaveLength(1);
    });

    it('should not create ephemeral wallet or deploy', async () => {
      const provider = mockProvider();
      const bundlerClient = mockBundlerClient();
      const now = Math.floor(Date.now() / 1000);

      const mocks = await setupInitializationMocks({
        provider,
        bundlerClient
      });

      // Initialize account in main wallet mode
      await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
        cache: mockCache
      });

      // Verify NO ephemeral wallet creation
      expect(mocks.toEphemeralSmartWallet).not.toHaveBeenCalled();
      expect(bundlerClient.sendUserOperation).not.toHaveBeenCalled();
    });
  });

  describe('payment functionality', () => {
    it('should make payment using the ephemeral wallet', async () => {
      // Pre-store valid data
      const permission = mockSpendPermission();
      const cacheKey = getCacheKey(TEST_WALLET_ADDRESS);
      mockCache.set(
        cacheKey,
        serializeWithBigInt({
          privateKey: TEST_PRIVATE_KEY,
          permission
        })
      );

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

      const now = Math.floor(Date.now() / 1000);

      // Initialize account
      const account = await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: true,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
        cache: mockCache
      });

      // Make a payment
      const paymentMaker = account.paymentMakers[0];
      const amount = new BigNumber(1.5); // 1.5 USDC

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount
      }];

      const result = await paymentMaker.makePayment(destinations, 'test payment');

      // Verify payment was made
      expect(result).not.toBeNull();
      expect(result!.transactionId).toBe('0xtxhash');
      expect(prepareSpendCallData).toHaveBeenCalledWith({ permission, amount: 1500000n }); // 1.5 USDC in smallest units
      expect(bundlerClient.sendUserOperation).toHaveBeenCalled();
    });
  });

  describe('getId', () => {
    it('should return correct account ID for ephemeral wallet', async () => {
      const bundlerClient = mockBundlerClient();
      const provider = mockProvider();
      const ephemeralWallet = mockEphemeralSmartWallet({ client: bundlerClient });
      const permission = mockSpendPermission();

      await setupInitializationMocks({
        bundlerClient,
        provider,
        ephemeralWallet,
        spendPermission: permission
      });

      const now = Math.floor(Date.now() / 1000);

      const account = await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: true,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
        cache: mockCache
      });

      const accountId = await account.getId();
      expect(accountId.network).toBe('polygon');
      expect(accountId.chain).toBe('polygon');
      expect(accountId.address).toBe(TEST_SMART_WALLET_ADDRESS);
    });

    it('should return correct account ID for main wallet', async () => {
      const provider = mockProvider();
      const now = Math.floor(Date.now() / 1000);

      const account = await PolygonAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        provider: provider,
        useEphemeralWallet: false,
        allowance: BigInt('10000000'),
        periodInDays: 30,
        periodStart: now,
        cache: mockCache
      });

      const accountId = await account.getId();
      expect(accountId.network).toBe('polygon');
      expect(accountId.chain).toBe('polygon');
      expect(accountId.address).toBe(TEST_WALLET_ADDRESS);
    });
  });
});
