import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';

const mockSmartAccount = {
  address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
};

const mockBundlerClient = {
  sendUserOperation: vi.fn(),
  waitForUserOperationReceipt: vi.fn(),
};

const mockAlchemyTransport = { type: 'alchemy', apiKey: 'mocked' };

// Mock viem/account-abstraction
vi.mock('viem/account-abstraction', () => ({
  toCoinbaseSmartAccount: vi.fn(() => Promise.resolve(mockSmartAccount)),
  createBundlerClient: vi.fn(() => mockBundlerClient),
}));

// Mock viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    http: vi.fn((url: string) => ({ url, type: 'http' })),
    createPublicClient: vi.fn(() => ({})),
  };
});

// Mock @account-kit/infra
vi.mock('@account-kit/infra', () => ({
  alchemy: vi.fn((config: { apiKey: string }) => ({
    ...mockAlchemyTransport,
    apiKey: config.apiKey
  })),
}));

import { toEphemeralSmartWallet } from './smartWalletHelpers.js';
import { createBundlerClient, toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { http } from 'viem';
import { alchemy } from '@account-kit/infra';

describe('smartWalletHelpers', () => {
  const testPrivateKey = generatePrivateKey();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to default behavior
    vi.mocked(toCoinbaseSmartAccount).mockResolvedValue(mockSmartAccount as any);
    vi.mocked(createBundlerClient).mockReturnValue(mockBundlerClient as any);
    // Clear environment variables before each test
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.ALCHEMY_GAS_POLICY_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('provider selection', () => {
    it('should use Coinbase when no Alchemy env vars are set', async () => {
      await toEphemeralSmartWallet(testPrivateKey);

      // Verify Coinbase URL was used (http transport)
      expect(http).toHaveBeenCalledWith(
        expect.stringContaining('api.developer.coinbase.com')
      );

      // Verify alchemy transport was NOT called
      expect(alchemy).not.toHaveBeenCalled();

      // Verify paymasterContext has transport (Coinbase style)
      expect(createBundlerClient).toHaveBeenCalledWith(
        expect.objectContaining({
          paymaster: true,
          paymasterContext: expect.objectContaining({
            transport: expect.any(Object),
          }),
        })
      );
    });

    it('should use Coinbase when only ALCHEMY_API_KEY is set', async () => {
      process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
      // ALCHEMY_GAS_POLICY_ID is not set

      await toEphemeralSmartWallet(testPrivateKey);

      // Should fall back to Coinbase
      expect(http).toHaveBeenCalledWith(
        expect.stringContaining('api.developer.coinbase.com')
      );
      expect(alchemy).not.toHaveBeenCalled();
    });

    it('should use Coinbase when only ALCHEMY_GAS_POLICY_ID is set', async () => {
      process.env.ALCHEMY_GAS_POLICY_ID = 'test-policy-id';
      // ALCHEMY_API_KEY is not set

      await toEphemeralSmartWallet(testPrivateKey);

      // Should fall back to Coinbase
      expect(http).toHaveBeenCalledWith(
        expect.stringContaining('api.developer.coinbase.com')
      );
      expect(alchemy).not.toHaveBeenCalled();
    });

    it('should use Alchemy when both ALCHEMY_API_KEY and ALCHEMY_GAS_POLICY_ID are set', async () => {
      process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
      process.env.ALCHEMY_GAS_POLICY_ID = 'test-policy-id';

      await toEphemeralSmartWallet(testPrivateKey);

      // Verify alchemy transport was called with the API key
      expect(alchemy).toHaveBeenCalledWith({ apiKey: 'test-alchemy-key' });

      // Verify paymasterContext has policyId (Alchemy style)
      expect(createBundlerClient).toHaveBeenCalledWith(
        expect.objectContaining({
          paymaster: true,
          paymasterContext: expect.objectContaining({
            policyId: 'test-policy-id',
          }),
        })
      );
    });
  });

  describe('Alchemy transport configuration', () => {
    beforeEach(() => {
      process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
      process.env.ALCHEMY_GAS_POLICY_ID = 'test-policy-id';
    });

    it('should use alchemy transport for Base mainnet (8453)', async () => {
      await toEphemeralSmartWallet(testPrivateKey, 8453);

      expect(alchemy).toHaveBeenCalledWith({ apiKey: 'test-alchemy-key' });
    });

    it('should use alchemy transport for Base Sepolia (84532)', async () => {
      await toEphemeralSmartWallet(testPrivateKey, 84532);

      expect(alchemy).toHaveBeenCalledWith({ apiKey: 'test-alchemy-key' });
    });

    it('should throw for unsupported chain ID with Alchemy', async () => {
      // Chain validation happens in getBaseChain first
      await expect(toEphemeralSmartWallet(testPrivateKey, 1)).rejects.toThrow(
        'Unsupported Base chain ID: 1'
      );
    });
  });

  describe('Coinbase URL generation', () => {
    it('should use correct Coinbase URL for Base mainnet (8453)', async () => {
      await toEphemeralSmartWallet(testPrivateKey, 8453);

      expect(http).toHaveBeenCalledWith(
        expect.stringContaining('api.developer.coinbase.com/rpc/v1/base/')
      );
    });

    it('should use correct Coinbase URL for Base Sepolia (84532)', async () => {
      await toEphemeralSmartWallet(testPrivateKey, 84532);

      expect(http).toHaveBeenCalledWith(
        expect.stringContaining('api.developer.coinbase.com/rpc/v1/base-sepolia/')
      );
    });

    it('should throw for unsupported chain ID with Coinbase', async () => {
      // Chain validation happens in getBaseChain first
      await expect(toEphemeralSmartWallet(testPrivateKey, 1)).rejects.toThrow(
        'Unsupported Base chain ID: 1'
      );
    });
  });

  describe('bundler client configuration', () => {
    it('should pass policyId in paymasterContext for Alchemy', async () => {
      process.env.ALCHEMY_API_KEY = 'my-api-key';
      process.env.ALCHEMY_GAS_POLICY_ID = 'my-policy-123';

      await toEphemeralSmartWallet(testPrivateKey);

      expect(createBundlerClient).toHaveBeenCalledWith(
        expect.objectContaining({
          paymasterContext: {
            policyId: 'my-policy-123',
          },
        })
      );
    });

    it('should pass transport in paymasterContext for Coinbase', async () => {
      await toEphemeralSmartWallet(testPrivateKey);

      expect(createBundlerClient).toHaveBeenCalledWith(
        expect.objectContaining({
          paymasterContext: expect.objectContaining({
            transport: expect.objectContaining({
              type: 'http',
              url: expect.stringContaining('api.developer.coinbase.com'),
            }),
          }),
        })
      );
    });

    it('should use alchemy transport in bundler client for Alchemy', async () => {
      process.env.ALCHEMY_API_KEY = 'my-api-key';
      process.env.ALCHEMY_GAS_POLICY_ID = 'my-policy-123';

      await toEphemeralSmartWallet(testPrivateKey);

      expect(createBundlerClient).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            type: 'alchemy',
          }),
        })
      );
    });

    it('should always set paymaster to true', async () => {
      // Test with Coinbase
      await toEphemeralSmartWallet(testPrivateKey);
      expect(createBundlerClient).toHaveBeenCalledWith(
        expect.objectContaining({ paymaster: true })
      );

      vi.clearAllMocks();

      // Test with Alchemy
      process.env.ALCHEMY_API_KEY = 'test-key';
      process.env.ALCHEMY_GAS_POLICY_ID = 'test-policy';
      await toEphemeralSmartWallet(testPrivateKey);
      expect(createBundlerClient).toHaveBeenCalledWith(
        expect.objectContaining({ paymaster: true })
      );
    });
  });

  describe('returned wallet structure', () => {
    it('should return correct wallet structure', async () => {
      const wallet = await toEphemeralSmartWallet(testPrivateKey);

      expect(wallet).toHaveProperty('address');
      expect(wallet).toHaveProperty('client');
      expect(wallet).toHaveProperty('account');
      expect(wallet).toHaveProperty('signer');
      expect(wallet.address).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    });
  });
});
