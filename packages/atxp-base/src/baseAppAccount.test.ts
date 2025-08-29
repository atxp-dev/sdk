import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAppAccount } from './baseAppAccount.js';
import { MemoryStorage } from './storage.js';
import { generatePrivateKey } from 'viem/accounts';
import { base } from 'viem/chains';
import type { SpendPermission } from './types.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import BigNumber from 'bignumber.js';

// Mock the entire @base-org/account module
vi.mock('@base-org/account', () => ({
  createBaseAccountSDK: vi.fn(() => ({
    getProvider: vi.fn(() => ({
      request: vi.fn()
    }))
  }))
}));

// Mock spend permission module
vi.mock('@base-org/account/spend-permission', () => ({
  requestSpendPermission: vi.fn(),
  prepareSpendCallData: vi.fn()
}));

// Mock viem/account-abstraction
vi.mock('viem/account-abstraction', () => ({
  toCoinbaseSmartAccount: vi.fn(),
  createBundlerClient: vi.fn()
}));

// Mock viem http transport
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    http: vi.fn(() => 'mock-transport'),
    createPublicClient: vi.fn(() => ({
      // Mock public client
    })),
    encodeFunctionData: vi.fn(() => '0xmockencodeddata')
  };
});

describe('BaseAppAccount', () => {
  let mockStorage: MemoryStorage;
  const mockApiKey = 'test-api-key';
  const mockWalletAddress = '0x1234567890123456789012345678901234567890';
  const mockSmartWalletAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const mockPrivateKey = generatePrivateKey();
  const mockPaymasterUrl = 'https://api.developer.coinbase.com/rpc/v1/base/snPdXqIzOGhRkGNJvEHM5bl9Hm3yRO3m';

  beforeEach(() => {
    mockStorage = new MemoryStorage();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should create a new account when no stored data exists', async () => {
      // Mock imports
      const { requestSpendPermission } = await import('@base-org/account/spend-permission');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient } = await import('viem');

      // Setup mock spend permission
      const mockSpendPermission: SpendPermission = {
        signature: '0xmocksignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000', // 10 USDC in smallest units
          period: 604800, // 7 days
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 604800,
          salt: '1',
          extraData: '0x'
        }
      };

      // Mock smart wallet account
      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock bundler client
      const mockBundlerClient = {
        sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
        waitForUserOperationReceipt: vi.fn().mockResolvedValue({
          success: true,
          receipt: { transactionHash: '0xtxhash' }
        })
      };

      // Setup mocks
      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);
      (requestSpendPermission as any).mockResolvedValue(mockSpendPermission);

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify account creation
      expect(account).toBeDefined();
      expect(account.accountId).toBe(mockSmartWalletAddress);
      expect(account.paymentMakers).toBeDefined();
      expect(account.paymentMakers.base).toBeDefined();

      // Verify smart wallet was deployed
      expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledWith({
        calls: [{
          to: mockSmartWalletAddress,
          value: 0n,
          data: '0x'
        }],
        paymaster: true
      });

      // Verify spend permission was requested
      expect(requestSpendPermission).toHaveBeenCalledWith({
        account: mockWalletAddress,
        spender: mockSmartWalletAddress,
        token: USDC_CONTRACT_ADDRESS_BASE,
        chainId: base.id,
        allowance: 10n,
        periodInDays: 7,
        provider: expect.any(Object)
      });

      // Verify data was stored
      const storageKey = `atxp-base-permission-${mockWalletAddress}`;
      const storedData = mockStorage.get(storageKey);
      expect(storedData).toBeTruthy();
      const parsedData = JSON.parse(storedData!);
      expect(parsedData.privateKey).toBeDefined();
      expect(parsedData.permission).toEqual(mockSpendPermission);
    });

    it('should reuse existing account when valid stored data exists', async () => {
      // Mock imports
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient } = await import('viem');

      // Setup stored permission that's not expired
      const mockSpendPermission: SpendPermission = {
        signature: '0xmocksignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000',
          period: 604800,
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 604800, // Not expired
          salt: '1',
          extraData: '0x'
        }
      };

      // Pre-store the data
      const storageKey = `atxp-base-permission-${mockWalletAddress}`;
      mockStorage.set(storageKey, JSON.stringify({
        privateKey: mockPrivateKey,
        permission: mockSpendPermission
      }));

      // Mock smart wallet account
      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock bundler client
      const mockBundlerClient = {
        sendUserOperation: vi.fn(),
        waitForUserOperationReceipt: vi.fn()
      };

      // Setup mocks
      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify account was loaded from storage
      expect(account).toBeDefined();
      expect(account.accountId).toBe(mockSmartWalletAddress);

      // Verify smart wallet was NOT deployed (reusing existing)
      expect(mockBundlerClient.sendUserOperation).not.toHaveBeenCalled();

      // Verify no new spend permission was requested
      const { requestSpendPermission } = await import('@base-org/account/spend-permission');
      expect(requestSpendPermission).not.toHaveBeenCalled();
    });

    it('should create new account when stored permission is expired', async () => {
      // Mock imports
      const { requestSpendPermission } = await import('@base-org/account/spend-permission');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient } = await import('viem');

      // Setup expired permission
      const expiredSpendPermission: SpendPermission = {
        signature: '0xmocksignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000',
          period: 604800,
          start: Math.floor(Date.now() / 1000) - 1000000,
          end: Math.floor(Date.now() / 1000) - 1000, // Expired
          salt: '1',
          extraData: '0x'
        }
      };

      // Pre-store the expired data
      const storageKey = `atxp-base-permission-${mockWalletAddress}`;
      mockStorage.set(storageKey, JSON.stringify({
        privateKey: mockPrivateKey,
        permission: expiredSpendPermission
      }));

      // Setup new permission
      const newSpendPermission: SpendPermission = {
        signature: '0xnewsignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000',
          period: 604800,
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 604800,
          salt: '2',
          extraData: '0x'
        }
      };

      // Mock smart wallet account
      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock bundler client
      const mockBundlerClient = {
        sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
        waitForUserOperationReceipt: vi.fn().mockResolvedValue({
          success: true,
          receipt: { transactionHash: '0xtxhash' }
        })
      };

      // Setup mocks
      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);
      (requestSpendPermission as any).mockResolvedValue(newSpendPermission);

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify new account was created
      expect(account).toBeDefined();
      expect(mockBundlerClient.sendUserOperation).toHaveBeenCalled();
      expect(requestSpendPermission).toHaveBeenCalled();

      // Verify old data was removed and new data stored
      const storedData = mockStorage.get(storageKey);
      expect(storedData).toBeTruthy();
      const parsedData = JSON.parse(storedData!);
      expect(parsedData.permission).toEqual(newSpendPermission);
    });

    it('should use custom allowance and period when provided', async () => {
      // Mock imports
      const { requestSpendPermission } = await import('@base-org/account/spend-permission');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient } = await import('viem');

      // Mock smart wallet account
      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock bundler client
      const mockBundlerClient = {
        sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
        waitForUserOperationReceipt: vi.fn().mockResolvedValue({
          success: true,
          receipt: { transactionHash: '0xtxhash' }
        })
      };

      // Setup mocks
      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);
      (requestSpendPermission as any).mockResolvedValue({
        signature: '0xmocksignature',
        permission: {} as any
      });

      // Initialize with custom values
      const customAllowance = 100n;
      const customPeriod = 30;

      await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        allowance: customAllowance,
        periodInDays: customPeriod,
        storage: mockStorage
      });

      // Verify custom values were used
      expect(requestSpendPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          allowance: customAllowance,
          periodInDays: customPeriod
        })
      );
    });

    it('should throw error when API key is not provided', async () => {
      await expect(BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: '',
        appName: 'Test App',
        storage: mockStorage
      })).rejects.toThrow('Smart wallet API key is required');
    });

    it('should make all required blockchain calls when creating new account', async () => {
      // Mock imports
      const { createBaseAccountSDK } = await import('@base-org/account');
      const { requestSpendPermission } = await import('@base-org/account/spend-permission');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient, http } = await import('viem');

      // Mock provider
      const mockProvider = {
        request: vi.fn()
      };
      const mockSDK = {
        getProvider: vi.fn(() => mockProvider)
      };
      (createBaseAccountSDK as any).mockReturnValue(mockSDK);

      // Setup mock spend permission
      const mockSpendPermission: SpendPermission = {
        signature: '0xmocksignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000',
          period: 604800,
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 604800,
          salt: '1',
          extraData: '0x'
        }
      };

      // Mock smart wallet account
      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock bundler client
      const mockBundlerClient = {
        sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
        waitForUserOperationReceipt: vi.fn().mockResolvedValue({
          success: true,
          receipt: { transactionHash: '0xtxhash' }
        })
      };

      // Setup mocks
      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);
      (requestSpendPermission as any).mockResolvedValue(mockSpendPermission);

      // Initialize account
      await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify SDK initialization
      expect(createBaseAccountSDK).toHaveBeenCalledTimes(1);
      expect(createBaseAccountSDK).toHaveBeenCalledWith({
        appName: 'Test App',
        appChainIds: [base.id],
        paymasterUrls: {
          [base.id]: mockPaymasterUrl
        }
      });

      // Verify wallet_connect attempt
      expect(mockProvider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });

      // Verify public client creation
      expect(createPublicClient).toHaveBeenCalledWith({
        chain: base,
        transport: expect.anything() // http transport
      });
      expect(http).toHaveBeenCalledWith(`https://api.developer.coinbase.com/rpc/v1/base/${mockApiKey}`);

      // Verify smart account creation
      expect(toCoinbaseSmartAccount).toHaveBeenCalledWith({
        client: expect.anything(),
        owners: [expect.objectContaining({
          address: expect.any(String) // The ephemeral wallet address
        })],
        version: '1'
      });

      // Verify bundler client creation
      expect(createBundlerClient).toHaveBeenCalledWith({
        account: mockSmartAccount,
        client: expect.anything(),
        transport: expect.anything(),
        chain: base,
        paymaster: true,
        paymasterContext: {
          transport: expect.anything()
        }
      });

      // Verify smart wallet deployment
      expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledTimes(1);
      expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledWith({
        calls: [{
          to: mockSmartWalletAddress,
          value: 0n,
          data: '0x'
        }],
        paymaster: true
      });
      expect(mockBundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({
        hash: '0xoperationhash'
      });

      // Verify spend permission request
      expect(requestSpendPermission).toHaveBeenCalledTimes(1);
      expect(requestSpendPermission).toHaveBeenCalledWith({
        account: mockWalletAddress,
        spender: mockSmartWalletAddress,
        token: USDC_CONTRACT_ADDRESS_BASE,
        chainId: base.id,
        allowance: 10n,
        periodInDays: 7,
        provider: mockProvider
      });
    });

    it('should skip deployment and permission when reusing stored account', async () => {
      // Mock imports
      const { createBaseAccountSDK } = await import('@base-org/account');
      const { requestSpendPermission } = await import('@base-org/account/spend-permission');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient, http } = await import('viem');

      // Mock provider
      const mockProvider = {
        request: vi.fn()
      };
      const mockSDK = {
        getProvider: vi.fn(() => mockProvider)
      };
      (createBaseAccountSDK as any).mockReturnValue(mockSDK);

      // Setup stored permission that's not expired
      const mockSpendPermission: SpendPermission = {
        signature: '0xmocksignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000',
          period: 604800,
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 604800, // Not expired
          salt: '1',
          extraData: '0x'
        }
      };

      // Pre-store the data
      const storageKey = `atxp-base-permission-${mockWalletAddress}`;
      mockStorage.set(storageKey, JSON.stringify({
        privateKey: mockPrivateKey,
        permission: mockSpendPermission
      }));

      // Mock smart wallet account
      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock bundler client
      const mockBundlerClient = {
        sendUserOperation: vi.fn(),
        waitForUserOperationReceipt: vi.fn()
      };

      // Setup mocks
      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);

      // Initialize account
      await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify SDK initialization still happens
      expect(createBaseAccountSDK).toHaveBeenCalledTimes(1);
      expect(createBaseAccountSDK).toHaveBeenCalledWith({
        appName: 'Test App',
        appChainIds: [base.id],
        paymasterUrls: {
          [base.id]: mockPaymasterUrl
        }
      });

      // Verify wallet_connect attempt still happens
      expect(mockProvider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });

      // Verify public client creation
      expect(createPublicClient).toHaveBeenCalledWith({
        chain: base,
        transport: expect.anything()
      });
      expect(http).toHaveBeenCalledWith(`https://api.developer.coinbase.com/rpc/v1/base/${mockApiKey}`);

      // Verify smart account creation with stored private key
      expect(toCoinbaseSmartAccount).toHaveBeenCalledWith({
        client: expect.anything(),
        owners: [expect.objectContaining({
          address: expect.any(String) // Should be derived from stored private key
        })],
        version: '1'
      });

      // Verify bundler client creation
      expect(createBundlerClient).toHaveBeenCalledWith({
        account: mockSmartAccount,
        client: expect.anything(),
        transport: expect.anything(),
        chain: base,
        paymaster: true,
        paymasterContext: {
          transport: expect.anything()
        }
      });

      // Verify NO smart wallet deployment
      expect(mockBundlerClient.sendUserOperation).not.toHaveBeenCalled();
      expect(mockBundlerClient.waitForUserOperationReceipt).not.toHaveBeenCalled();

      // Verify NO new spend permission request
      expect(requestSpendPermission).not.toHaveBeenCalled();
    });

    it('should handle wallet_connect failure gracefully', async () => {
      // Mock imports
      const { createBaseAccountSDK } = await import('@base-org/account');
      const { requestSpendPermission } = await import('@base-org/account/spend-permission');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient } = await import('viem');

      // Mock provider that fails wallet_connect
      const mockProvider = {
        request: vi.fn().mockRejectedValue(new Error('Wallet does not support wallet_connect'))
      };
      const mockSDK = {
        getProvider: vi.fn(() => mockProvider)
      };
      (createBaseAccountSDK as any).mockReturnValue(mockSDK);

      // Setup other mocks
      const mockSpendPermission: SpendPermission = {
        signature: '0xmocksignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000',
          period: 604800,
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 604800,
          salt: '1',
          extraData: '0x'
        }
      };

      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      const mockBundlerClient = {
        sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
        waitForUserOperationReceipt: vi.fn().mockResolvedValue({
          success: true,
          receipt: { transactionHash: '0xtxhash' }
        })
      };

      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);
      (requestSpendPermission as any).mockResolvedValue(mockSpendPermission);

      // Initialize account - should not throw despite wallet_connect failure
      const account = await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      });

      // Verify initialization continued despite wallet_connect failure
      expect(account).toBeDefined();
      expect(mockProvider.request).toHaveBeenCalledWith({ method: 'wallet_connect' });
      expect(mockBundlerClient.sendUserOperation).toHaveBeenCalled();
      expect(requestSpendPermission).toHaveBeenCalled();
    });

    it('should throw when smart wallet deployment fails', async () => {
      // Mock imports
      const { createBaseAccountSDK } = await import('@base-org/account');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient } = await import('viem');

      // Setup mocks
      const mockProvider = { request: vi.fn() };
      const mockSDK = { getProvider: vi.fn(() => mockProvider) };
      (createBaseAccountSDK as any).mockReturnValue(mockSDK);

      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock failed deployment
      const mockBundlerClient = {
        sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
        waitForUserOperationReceipt: vi.fn().mockResolvedValue({
          success: false, // Deployment failed
          receipt: { transactionHash: '0xtxhash' }
        })
      };

      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);

      // Initialize should throw
      await expect(BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      })).rejects.toThrow('Smart wallet deployment failed');
    });
  });

  describe('clearAllStoredData', () => {
    it('should remove stored data for the given wallet address', () => {
      const storageKey = `atxp-base-permission-${mockWalletAddress}`;
      
      // Store some data
      mockStorage.set(storageKey, 'test-data');
      expect(mockStorage.get(storageKey)).toBe('test-data');

      // Clear the data
      BaseAppAccount.clearAllStoredData(mockWalletAddress, mockStorage);

      // Verify data was removed
      expect(mockStorage.get(storageKey)).toBeNull();
    });

    it('should throw error when called outside browser without storage', () => {
      // Mock window as undefined (non-browser environment)
      const originalWindow = global.window;
      (global as any).window = undefined;

      expect(() => {
        BaseAppAccount.clearAllStoredData(mockWalletAddress);
      }).toThrow('clearAllStoredData requires a storage to be provided outside of browser environments');

      // Restore window
      (global as any).window = originalWindow;
    });
  });

  describe('payment functionality', () => {
    it('should make payment using the ephemeral wallet', async () => {
      // Mock imports
      const { prepareSpendCallData } = await import('@base-org/account/spend-permission');
      const { toCoinbaseSmartAccount, createBundlerClient } = await import('viem/account-abstraction');
      const { createPublicClient } = await import('viem');

      // Setup mock spend permission
      const mockSpendPermission: SpendPermission = {
        signature: '0xmocksignature',
        permission: {
          account: mockWalletAddress,
          spender: mockSmartWalletAddress,
          token: USDC_CONTRACT_ADDRESS_BASE,
          allowance: '10000000',
          period: 604800,
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 604800,
          salt: '1',
          extraData: '0x'
        }
      };

      // Pre-store valid data
      const storageKey = `atxp-base-permission-${mockWalletAddress}`;
      mockStorage.set(storageKey, JSON.stringify({
        privateKey: mockPrivateKey,
        permission: mockSpendPermission
      }));

      // Mock smart wallet account
      const mockSmartAccount = {
        address: mockSmartWalletAddress,
        signMessage: vi.fn().mockResolvedValue('0xmocksignature')
      };

      // Mock bundler client
      const mockBundlerClient = {
        sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
        waitForUserOperationReceipt: vi.fn().mockResolvedValue({
          success: true,
          userOpHash: '0xoperationhash',
          receipt: { transactionHash: '0xtxhash' }
        }),
        account: {
          client: {
            waitForTransactionReceipt: vi.fn().mockResolvedValue({})
          }
        }
      };

      // Mock spend permission calls
      const mockSpendCalls = [
        { to: '0xcontract1', data: '0xdata1', value: '0x0' },
        { to: '0xcontract2', data: '0xdata2', value: '0x0' }
      ];
      (prepareSpendCallData as any).mockResolvedValue(mockSpendCalls);

      // Setup mocks
      (createPublicClient as any).mockReturnValue({});
      (toCoinbaseSmartAccount as any).mockResolvedValue(mockSmartAccount);
      (createBundlerClient as any).mockReturnValue(mockBundlerClient);

      // Initialize account
      const account = await BaseAppAccount.initialize({
        walletAddress: mockWalletAddress,
        apiKey: mockApiKey,
        appName: 'Test App',
        storage: mockStorage
      });

      // Make a payment
      const paymentMaker = account.paymentMakers.base;
      const amount = new BigNumber(1.5); // 1.5 USDC
      const receiver = '0x1234567890123456789012345678901234567890';
      const txHash = await paymentMaker.makePayment(amount, 'USDC', receiver, 'test payment');

      // Verify payment was made
      expect(txHash).toBe('0xtxhash');
      expect(prepareSpendCallData).toHaveBeenCalledWith(mockSpendPermission, 1500000n); // 1.5 USDC in smallest units
      expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledWith({
        account: mockSmartAccount,
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
