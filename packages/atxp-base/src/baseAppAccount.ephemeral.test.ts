import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external modules before imports
vi.mock('@base-org/account', () => ({
  createBaseAccountSDK: vi.fn(() => ({
    getProvider: vi.fn(() => ({
      request: vi.fn()
    }))
  }))
}));

vi.mock('@base-org/account/spend-permission/browser', () => ({
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

import { BaseAppAccount } from './baseAppAccount.js';
import { MemoryStorage } from './storage.js';
import { base } from 'viem/chains';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import BigNumber from 'bignumber.js';
import {
  TEST_API_KEY,
  TEST_WALLET_ADDRESS,
  TEST_SMART_WALLET_ADDRESS,
  TEST_RECEIVER_ADDRESS,
  TEST_PRIVATE_KEY,
  TEST_PAYMASTER_URL,
  TEST_BUNDLER_URL,
  setupInitializationMocks,
  setupPaymentMocks,
  mockSpendPermission,
  mockExpiredSpendPermission,
  mockSmartAccount,
  mockBundlerClient,
  mockFailedBundlerClient,
  mockProvider,
  mockSpendCalls,
  getStorageKey,
  removeTimestamps,
  expectTimestampAround
} from './testHelpers.js';

describe('BaseAppAccount', () => {
  let mockStorage: MemoryStorage;

  beforeEach(() => {
    mockStorage = new MemoryStorage();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should create a new account when no stored data exists', async () => {
      const bundlerClient = mockBundlerClient();
      const mocks = await setupInitializationMocks({ bundlerClient });

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify account creation
      expect(account).toBeDefined();
      expect(account.accountId).toBe(TEST_SMART_WALLET_ADDRESS);
      expect(account.paymentMakers).toBeDefined();
      expect(account.paymentMakers.base).toBeDefined();

      // Verify smart wallet was deployed
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        calls: [{
          to: TEST_SMART_WALLET_ADDRESS,
          value: 0n,
          data: '0x'
        }],
        paymaster: true
      });

      // Verify spend permission was requested
      expect(mocks.requestSpendPermission).toHaveBeenCalledWith({
        account: TEST_WALLET_ADDRESS,
        spender: TEST_SMART_WALLET_ADDRESS,
        token: USDC_CONTRACT_ADDRESS_BASE,
        chainId: base.id,
        allowance: 10n,
        periodInDays: 7,
        provider: expect.any(Object)
      });

      // Verify data was stored
      const storageKey = getStorageKey(TEST_WALLET_ADDRESS);
      const storedData = mockStorage.get(storageKey);
      expect(storedData).toBeTruthy();
      const parsedData = JSON.parse(storedData!);
      expect(parsedData.privateKey).toBeDefined();
      
      // Compare permission structure (toMatchObject ignores extra properties in received)
      expect(parsedData.permission).toMatchObject(removeTimestamps(mockSpendPermission()));
      
      // Verify timestamps are reasonable
      expectTimestampAround(parsedData.permission.permission.start, 0); // Should be around now
      expectTimestampAround(parsedData.permission.permission.end, 604800); // Should be ~7 days from now
    });

    it('should reuse existing account when valid stored data exists', async () => {
      // Pre-store valid permission
      const permission = mockSpendPermission();
      const storageKey = getStorageKey(TEST_WALLET_ADDRESS);
      mockStorage.set(storageKey, JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        permission
      }));

      const bundlerClient = mockBundlerClient();
      const mocks = await setupInitializationMocks({ bundlerClient });

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
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
      const storageKey = getStorageKey(TEST_WALLET_ADDRESS);
      mockStorage.set(storageKey, JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        permission: expiredPermission
      }));

      const newPermission = mockSpendPermission({ salt: '2', signature: '0xnewsignature' });
      const bundlerClient = mockBundlerClient();
      const mocks = await setupInitializationMocks({ 
        bundlerClient,
        spendPermission: newPermission 
      });

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify new account was created
      expect(account).toBeDefined();
      expect(bundlerClient.sendUserOperation).toHaveBeenCalled();
      expect(mocks.requestSpendPermission).toHaveBeenCalled();

      // Verify old data was removed and new data stored
      const storedData = mockStorage.get(storageKey);
      expect(storedData).toBeTruthy();
      const parsedData = JSON.parse(storedData!);
      expect(parsedData.permission).toMatchObject(removeTimestamps(newPermission));
      
      // Verify timestamps are reasonable
      expectTimestampAround(parsedData.permission.permission.start, 0);
      expectTimestampAround(parsedData.permission.permission.end, 604800);
    });

    it('should use custom allowance and period when provided', async () => {
      const mocks = await setupInitializationMocks();

      // Initialize with custom values
      const customAllowance = 100n;
      const customPeriod = 30;

      await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        allowance: customAllowance,
        periodInDays: customPeriod,
        storage: mockStorage
      });

      // Verify custom values were used
      expect(mocks.requestSpendPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          allowance: customAllowance,
          periodInDays: customPeriod
        })
      );
    });

    it('should throw error when API key is not provided', async () => {
      await expect(BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: '',
        appName: 'Test App',
        storage: mockStorage
      })).rejects.toThrow('Smart wallet API key is required');
    });

    it('should make all required blockchain calls when creating new account', async () => {
      const provider = mockProvider();
      const bundlerClient = mockBundlerClient();
      const smartAccount = mockSmartAccount();
      const permission = mockSpendPermission();
      
      const mocks = await setupInitializationMocks({
        provider,
        bundlerClient,
        smartAccount,
        spendPermission: permission
      });

      const { http } = await import('viem');

      // Initialize account
      await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify SDK initialization
      expect(mocks.createBaseAccountSDK).toHaveBeenCalledTimes(1);
      expect(mocks.createBaseAccountSDK).toHaveBeenCalledWith({
        appName: 'Test App',
        appChainIds: [base.id],
        paymasterUrls: {
          [base.id]: TEST_PAYMASTER_URL
        }
      });

      // Verify wallet_connect attempt
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });

      // Verify public client creation
      expect(mocks.createPublicClient).toHaveBeenCalledWith({
        chain: base,
        transport: expect.anything()
      });
      expect(http).toHaveBeenCalledWith(`${TEST_BUNDLER_URL}/${TEST_API_KEY}`);

      // Verify smart account creation
      expect(mocks.toCoinbaseSmartAccount).toHaveBeenCalledWith({
        client: expect.anything(),
        owners: [expect.objectContaining({
          address: expect.any(String)
        })],
        version: '1'
      });

      // Verify bundler client creation
      expect(mocks.createBundlerClient).toHaveBeenCalledWith({
        account: smartAccount,
        client: expect.anything(),
        transport: expect.anything(),
        chain: base,
        paymaster: true,
        paymasterContext: {
          transport: expect.anything()
        }
      });

      // Verify smart wallet deployment
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledTimes(1);
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        calls: [{
          to: TEST_SMART_WALLET_ADDRESS,
          value: 0n,
          data: '0x'
        }],
        paymaster: true
      });
      expect(bundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({
        hash: '0xoperationhash'
      });

      // Verify spend permission request
      expect(mocks.requestSpendPermission).toHaveBeenCalledTimes(1);
      expect(mocks.requestSpendPermission).toHaveBeenCalledWith({
        account: TEST_WALLET_ADDRESS,
        spender: TEST_SMART_WALLET_ADDRESS,
        token: USDC_CONTRACT_ADDRESS_BASE,
        chainId: base.id,
        allowance: 10n,
        periodInDays: 7,
        provider: provider
      });
    });

    it('should skip deployment and permission when reusing stored account', async () => {
      // Pre-store valid permission
      const permission = mockSpendPermission();
      const storageKey = getStorageKey(TEST_WALLET_ADDRESS);
      mockStorage.set(storageKey, JSON.stringify({
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

      const { http } = await import('viem');

      // Initialize account
      await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify SDK initialization still happens
      expect(mocks.createBaseAccountSDK).toHaveBeenCalledTimes(1);
      expect(mocks.createBaseAccountSDK).toHaveBeenCalledWith({
        appName: 'Test App',
        appChainIds: [base.id],
        paymasterUrls: {
          [base.id]: TEST_PAYMASTER_URL
        }
      });

      // Verify wallet_connect attempt still happens
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });

      // Verify public client creation
      expect(mocks.createPublicClient).toHaveBeenCalledWith({
        chain: base,
        transport: expect.anything()
      });
      expect(http).toHaveBeenCalledWith(`${TEST_BUNDLER_URL}/${TEST_API_KEY}`);

      // Verify smart account creation with stored private key
      expect(mocks.toCoinbaseSmartAccount).toHaveBeenCalledWith({
        client: expect.anything(),
        owners: [expect.objectContaining({
          address: expect.any(String)
        })],
        version: '1'
      });

      // Verify bundler client creation
      expect(mocks.createBundlerClient).toHaveBeenCalledWith({
        account: smartAccount,
        client: expect.anything(),
        transport: expect.anything(),
        chain: base,
        paymaster: true,
        paymasterContext: {
          transport: expect.anything()
        }
      });

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
      const mocks = await setupInitializationMocks({ provider, bundlerClient });

      // Initialize account - should not throw despite wallet_connect failure
      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify initialization continued despite wallet_connect failure
      expect(account).toBeDefined();
      expect(provider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
      expect(bundlerClient.sendUserOperation).toHaveBeenCalled();
      expect(mocks.requestSpendPermission).toHaveBeenCalled();
    });

    it('should throw when smart wallet deployment fails', async () => {
      const bundlerClient = mockFailedBundlerClient({ failureType: 'deployment' });
      await setupInitializationMocks({ bundlerClient });

      // Initialize should throw
      await expect(BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
      })).rejects.toThrow('Smart wallet deployment failed');
    });
  });

  describe('clearAllStoredData', () => {
    it('should remove stored data for the given wallet address', () => {
      const storageKey = getStorageKey(TEST_WALLET_ADDRESS);
      
      // Store some data
      mockStorage.set(storageKey, 'test-data');
      expect(mockStorage.get(storageKey)).toBe('test-data');

      // Clear the data
      BaseAppAccount.clearAllStoredData(TEST_WALLET_ADDRESS, mockStorage);

      // Verify data was removed
      expect(mockStorage.get(storageKey)).toBeNull();
    });

    it('should throw error when called outside browser without storage', () => {
      // Mock window as undefined (non-browser environment)
      const originalWindow = global.window;
      (global as any).window = undefined;

      expect(() => {
        BaseAppAccount.clearAllStoredData(TEST_WALLET_ADDRESS);
      }).toThrow('clearAllStoredData requires a storage to be provided outside of browser environments');

      // Restore window
      (global as any).window = originalWindow;
    });
  });

  describe('payment functionality', () => {
    it('should make payment using the ephemeral wallet', async () => {
      // Pre-store valid data
      const permission = mockSpendPermission();
      const storageKey = getStorageKey(TEST_WALLET_ADDRESS);
      mockStorage.set(storageKey, JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        permission
      }));

      const bundlerClient = mockBundlerClient();
      const smartAccount = mockSmartAccount();
      const spendCalls = mockSpendCalls();
      
      await setupInitializationMocks({ bundlerClient, smartAccount });
      const { prepareSpendCallData } = await setupPaymentMocks({ spendCalls });

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: TEST_WALLET_ADDRESS,
        apiKey: TEST_API_KEY,
        appName: 'Test App',
        storage: mockStorage
      });

      // Make a payment
      const paymentMaker = account.paymentMakers.base;
      const amount = new BigNumber(1.5); // 1.5 USDC
      const txHash = await paymentMaker.makePayment(amount, 'USDC', TEST_RECEIVER_ADDRESS, 'test payment');

      // Verify payment was made
      expect(txHash).toBe('0xtxhash');
      expect(prepareSpendCallData).toHaveBeenCalledWith(permission, 1500000n); // 1.5 USDC in smallest units
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        account: smartAccount,
        calls: [
          // Spend permission calls
          { to: '0xcontract1', data: '0xdata1', value: 0n },
          { to: '0xcontract2', data: '0xdata2', value: 0n },
          // Transfer call
          {
            to: USDC_CONTRACT_ADDRESS_BASE,
            data: expect.any(String), // Encoded transfer function
            value: 0n
          }
        ],
        maxPriorityFeePerGas: expect.any(BigInt)
      });
    });
  });
});
