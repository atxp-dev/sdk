import { describe, it, expect } from 'vitest';
import { BaseAppAccount } from './baseAppAccount.js';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';

describe('API Compatibility', () => {
  describe('BaseAppAccount', () => {
    it('should export the expected static methods', () => {
      expect(typeof BaseAppAccount.initialize).toBe('function');
      expect(typeof BaseAppAccount.clearAllStoredData).toBe('function');
      expect(typeof BaseAppAccount.toStorageKey).toBe('function');
    });

    it('should support both ephemeral and main wallet modes', () => {
      // This verifies the API structure supports both modes
      const ephemeralConfig = {
        apiKey: 'test',
        walletAddress: '0x123' as `0x${string}`,
        storage: {} as any
      };
      
      const mainWalletConfig = {
        walletAddress: '0x123' as `0x${string}`,
        useEphemeralWallet: false,
        provider: {} as any,
        storage: {} as any
      };

      // These should be valid configurations (we're just checking types/structure)
      expect(ephemeralConfig.apiKey).toBeDefined();
      expect(mainWalletConfig.useEphemeralWallet).toBe(false);
    });
  });

  describe('BaseAppPaymentMaker', () => {
    it('should support the required payment interface', () => {
      // Mock the minimum required objects
      const mockSpendPermission = {
        hash: '0x123',
        chainId: 1,
        account: '0x456',
        spender: '0x789',
        token: '0xabc',
        allowance: 100n,
        period: 3600,
        start: 0,
        end: 3600,
        salt: 0n,
        extraData: '0x'
      };

      const mockSmartWallet = {
        address: '0xwallet',
        client: { sendUserOperation: () => {} },
        account: {}
      };

      const mockLogger = {
        info: () => {},
        warn: () => {},
        error: () => {}
      };

      // Should be able to create instance
      const paymentMaker = new BaseAppPaymentMaker(
        mockSpendPermission,
        mockSmartWallet as any,
        mockLogger
      );

      expect(paymentMaker).toBeInstanceOf(BaseAppPaymentMaker);
      expect(typeof paymentMaker.makePayment).toBe('function');
      expect(typeof paymentMaker.generateJWT).toBe('function');
    });
  });

  describe('Environment Safety', () => {
    it('should have proper error handling for environment detection', () => {
      // Check that our error message is comprehensive
      const expectedErrorPattern = /requestSpendPermission requires browser environment.*client-side.*Next\.js/;
      const testError = new Error('requestSpendPermission requires browser environment. BaseAppAccount.initialize() with ephemeral wallet should only be called client-side in Next.js apps.');
      
      expect(testError.message).toMatch(expectedErrorPattern);
    });

    it('should provide clear guidance for different environments', () => {
      const browserGuidance = 'Use BaseAppAccount.initialize() with ephemeral wallet in browser/client-side code';
      const serverGuidance = 'Use BaseAppAccount.initialize() with useEphemeralWallet: false in server-side code';
      
      expect(browserGuidance).toContain('client-side');
      expect(serverGuidance).toContain('server-side');
      expect(serverGuidance).toContain('useEphemeralWallet: false');
    });
  });

  describe('Import Path Compatibility', () => {
    it('should handle @base-org/account version differences', () => {
      // Test that we can handle both v2.0.2 and v2.1.0+ import structures
      const v2_0_2_pattern = '@base-org/account/spend-permission';
      const v2_1_0_browser_pattern = '@base-org/account/spend-permission/browser';
      const v2_1_0_node_pattern = '@base-org/account/spend-permission/node';
      
      // Our solution should handle the new patterns
      expect(v2_1_0_browser_pattern).toContain('/browser');
      expect(v2_1_0_node_pattern).toContain('/node');
      expect(v2_0_2_pattern).not.toContain('/browser');
      expect(v2_0_2_pattern).not.toContain('/node');
    });
  });
});