import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock window object to simulate browser environment
Object.defineProperty(global, 'window', {
  value: {},
  writable: true,
  configurable: true
});

// Mock all external modules before imports
vi.mock('./spendPermissionShim.js', () => ({
  requestSpendPermission: vi.fn(),
  prepareSpendCallData: vi.fn()
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    encodeFunctionData: vi.fn(() => '0xmockencodeddata')
  };
});

import { getPolygonUSDCAddress } from '@atxp/client';
import BigNumber from 'bignumber.js';
import {
  mockSpendPermission,
  mockEphemeralSmartWallet,
  mockBundlerClient,
  mockFailedBundlerClient,
  TEST_RECEIVER_ADDRESS
} from './testHelpers.js';
import { SmartWalletPaymentMaker } from './smartWalletPaymentMaker.js';

describe('SmartWalletPaymentMaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateJWT', () => {
    it('should generate EIP-1271 JWT with smart wallet signature', async () => {
      const permission = mockSpendPermission();
      const smartWallet = mockEphemeralSmartWallet();

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);
      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // Should return JWT format (header.payload.signature)
      expect(jwt).toBeDefined();
      expect(typeof jwt).toBe('string');

      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      // Decode JWT header
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      expect(header).toEqual({
        alg: 'EIP1271',
        typ: 'JWT'
      });

      // Decode JWT payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload.sub).toBe(smartWallet.address);
      expect(payload.iss).toBe('accounts.atxp.ai');
      expect(payload.aud).toBe('https://auth.atxp.ai');
      expect(payload.payment_request_id).toBe('test-payment-id');
      expect(payload.code_challenge).toBe('test-challenge');
      expect(payload.msg).toContain('PayMCP Authorization Request');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('should generate JWT without optional fields', async () => {
      const permission = mockSpendPermission();
      const smartWallet = mockEphemeralSmartWallet();

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);
      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: '',
        codeChallenge: ''
      });

      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload.sub).toBe(smartWallet.address);
      expect(payload.payment_request_id).toBeUndefined();
      expect(payload.code_challenge).toBeUndefined();
    });
  });

  describe('makePayment', () => {
    it('should successfully make a USDC payment', async () => {
      const permission = mockSpendPermission();
      const bundlerClient = mockBundlerClient();
      const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      // Setup mock for prepareSpendCallData
      const { prepareSpendCallData } = await import('./spendPermissionShim.js');
      (prepareSpendCallData as any).mockResolvedValue([
        { to: getPolygonUSDCAddress(137), data: '0xapprovedata', value: 0n }
      ]);

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);

      // Make payment
      const amount = new BigNumber(5.25); // 5.25 USDC
      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount
      }];
      const result = await paymentMaker.makePayment(destinations, 'test memo');

      // Verify result
      expect(result).toBeDefined();
      expect(result!.transactionId).toBe('0xtxhash');
      expect(result!.chain).toBe('polygon');

      // Verify prepareSpendCallData was called correctly
      expect(prepareSpendCallData).toHaveBeenCalledWith({
        permission,
        amount: 5250000n // 5.25 USDC in smallest units (6 decimals)
      });

      // Verify sendUserOperation was called
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
        account: smartWallet.account,
        calls: expect.arrayContaining([
          expect.objectContaining({
            to: getPolygonUSDCAddress(137),
            data: '0xapprovedata',
            value: 0n
          }),
          expect.objectContaining({
            to: getPolygonUSDCAddress(137),
            data: expect.any(String), // This should contain the memo
            value: 0n
          })
        ]),
        maxPriorityFeePerGas: expect.any(BigInt)
      });
    });

    it('should fail when bundler client fails', async () => {
      const permission = mockSpendPermission();
      const bundlerClient = mockFailedBundlerClient({ failureType: 'receipt' });
      const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      // Setup mock for prepareSpendCallData
      const { prepareSpendCallData } = await import('./spendPermissionShim.js');
      (prepareSpendCallData as any).mockResolvedValue([
        { to: getPolygonUSDCAddress(137), data: '0xdata', value: 0n }
      ]);

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);

      // Make payment - should throw
      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];
      await expect(paymentMaker.makePayment(destinations, 'test memo')).rejects.toThrow(
        'User operation failed'
      );
    });

    it('should handle zero amount payments', async () => {
      const permission = mockSpendPermission();
      const bundlerClient = mockBundlerClient();
      const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      // Setup mock for prepareSpendCallData
      const { prepareSpendCallData } = await import('./spendPermissionShim.js');
      (prepareSpendCallData as any).mockResolvedValue([
        { to: getPolygonUSDCAddress(137), data: '0xdata', value: 0n }
      ]);

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);

      // Make zero amount payment
      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(0)
      }];
      const result = await paymentMaker.makePayment(destinations, 'zero amount memo');

      // Verify result
      expect(result).toBeDefined();
      expect(result!.transactionId).toBe('0xtxhash');

      // Verify prepareSpendCallData was called with zero amount
      expect(prepareSpendCallData).toHaveBeenCalledWith({
        permission,
        amount: 0n
      });
    });

    it('should handle fractional USDC amounts correctly', async () => {
      const permission = mockSpendPermission();
      const bundlerClient = mockBundlerClient();
      const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      // Setup mock for prepareSpendCallData
      const { prepareSpendCallData } = await import('./spendPermissionShim.js');
      (prepareSpendCallData as any).mockResolvedValue([
        { to: getPolygonUSDCAddress(137), data: '0xdata', value: 0n }
      ]);

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);

      // Test various fractional amounts
      const testCases = [
        { input: new BigNumber('0.000001'), expected: 1n }, // 1 micro USDC
        { input: new BigNumber('0.1'), expected: 100000n }, // 0.1 USDC
        { input: new BigNumber('1.123456'), expected: 1123456n }, // 1.123456 USDC
        { input: new BigNumber('999.999999'), expected: 999999999n } // 999.999999 USDC
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();

        const destinations = [{
          chain: 'polygon' as const,
          currency: 'USDC' as const,
          address: TEST_RECEIVER_ADDRESS,
          amount: testCase.input
        }];
        await paymentMaker.makePayment(destinations, 'fractional test');

        expect(prepareSpendCallData).toHaveBeenCalledWith({
          permission,
          amount: testCase.expected
        });
      }
    });

    it('should throw error for non-USDC currency', async () => {
      const permission = mockSpendPermission();
      const smartWallet = mockEphemeralSmartWallet();

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'ETH' as any,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await expect(paymentMaker.makePayment(destinations, 'test')).rejects.toThrow(
        'Only usdc currency is supported'
      );
    });

    it('should append memo to transfer', async () => {
      const permission = mockSpendPermission();
      const bundlerClient = mockBundlerClient();
      const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      // Setup mock for prepareSpendCallData
      const { prepareSpendCallData } = await import('./spendPermissionShim.js');
      (prepareSpendCallData as any).mockResolvedValue([
        { to: getPolygonUSDCAddress(137), data: '0xdata', value: 0n }
      ]);

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];
      const memo = 'Payment for service #12345';
      await paymentMaker.makePayment(destinations, memo);

      // Verify sendUserOperation included memo call
      expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          calls: expect.arrayContaining([
            expect.objectContaining({
              to: getPolygonUSDCAddress(137),
              data: expect.any(String) // Contains memo
            })
          ])
        })
      );
    });

    it('should handle large amounts correctly', async () => {
      const permission = mockSpendPermission();
      const bundlerClient = mockBundlerClient();
      const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

      // Setup mock for prepareSpendCallData
      const { prepareSpendCallData } = await import('./spendPermissionShim.js');
      (prepareSpendCallData as any).mockResolvedValue([
        { to: getPolygonUSDCAddress(137), data: '0xdata', value: 0n }
      ]);

      const paymentMaker = new SmartWalletPaymentMaker(permission, smartWallet as any);

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1000000) // 1 million USDC
      }];
      await paymentMaker.makePayment(destinations, 'large payment');

      // Should handle large amounts correctly
      expect(prepareSpendCallData).toHaveBeenCalledWith({
        permission,
        amount: 1000000000000n // 1M USDC = 1,000,000,000,000 units
      });
    });
  });
});
