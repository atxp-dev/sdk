import { describe, it, expect, vi } from 'vitest';

// Mock window object to simulate browser environment for payment maker tests
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

import { USDC_CONTRACT_ADDRESS_WORLD_MAINNET } from '@atxp/client';
import BigNumber from 'bignumber.js';
import {
  mockSpendPermission,
  mockEphemeralSmartWallet,
  mockBundlerClient,
  mockFailedBundlerClient,
  TEST_RECEIVER_ADDRESS,
  createTestWorldchainPaymentMaker,
  TestWorldchainPaymentMakerBuilder
} from './testHelpers.js';

describe('WorldchainPaymentMaker.generateJWT', () => {
  it('should generate EIP-1271 auth data with default payload', async () => {
    const permission = mockSpendPermission();
    const smartWallet = mockEphemeralSmartWallet();

    const paymentMaker = createTestWorldchainPaymentMaker(permission, smartWallet);
    const authData = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: 'testCodeChallenge'});

    // Should return JWT format (header.payload.signature)
    expect(authData).toBeDefined();
    expect(typeof authData).toBe('string');

    // Verify JWT structure
    const parts = authData.split('.');
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
    expect(payload.msg).toContain('PayMCP Authorization Request');
    expect(payload.iat).toBeDefined();
    expect(payload.code_challenge).toBe('testCodeChallenge');

    // Decode JWT signature
    const signature = Buffer.from(parts[2], 'base64url').toString();
    expect(signature).toBeDefined();
  });

  it('should include payment request id if provided', async () => {
    const permission = mockSpendPermission();
    const smartWallet = mockEphemeralSmartWallet();

    // Example of using the builder pattern for more complex configurations
    const paymentMaker = new TestWorldchainPaymentMakerBuilder()
      .withPermission(permission)
      .withSmartWallet(smartWallet)
      .withTestDelays()
      .build();

    const paymentRequestId = 'id1';
    const authData = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: ''});

    // Verify JWT includes payment request ID
    const parts = authData.split('.');
    expect(parts).toHaveLength(3);

    // Decode JWT payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.payment_request_id).toEqual(paymentRequestId);
    expect(payload.msg).toContain(`Payment Request ID: ${paymentRequestId}`);
  });
});

describe('WorldchainPaymentMaker.makePayment', () => {
  it('should successfully make a USDC payment', async () => {
    const permission = mockSpendPermission();
    const bundlerClient = mockBundlerClient();
    const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

    // Setup mock for prepareSpendCallData
    const { prepareSpendCallData } = await import('./spendPermissionShim.js');
    (prepareSpendCallData as any).mockResolvedValue([
      { to: USDC_CONTRACT_ADDRESS_WORLD_MAINNET, data: '0xmockencodeddata', value: 0n }
    ]);

    const paymentMaker = createTestWorldchainPaymentMaker(permission, smartWallet);

    // Make payment
    const amount = new BigNumber(5.25); // 5.25 USDC
    const destinations = [{
      chain: 'world' as const,
      currency: 'USDC' as const,
      address: TEST_RECEIVER_ADDRESS,
      amount
    }];
    const result = await paymentMaker.makePayment(destinations, 'test memo');

    // Verify result
    expect(result).toBeDefined();
    expect(result!.transactionId).toBe('0xtxhash');

    // Verify prepareSpendCallData was called correctly
    expect(prepareSpendCallData).toHaveBeenCalledWith({
      permission,
      amount: 5250000n // 5.25 USDC in smallest units (micro USDC)
    });

    // Verify sendUserOperation was called
    expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
      account: smartWallet.account,
      calls: expect.arrayContaining([
        expect.objectContaining({
          to: USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
          data: '0xmockencodeddata',
          value: 0n
        }),
        expect.objectContaining({
          to: USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
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
      { to: USDC_CONTRACT_ADDRESS_WORLD_MAINNET, data: '0xmockencodeddata', value: 0n }
    ]);

    const paymentMaker = createTestWorldchainPaymentMaker(permission, smartWallet);

    // Make payment - should throw
    const destinations = [{
      chain: 'world' as const,
      currency: 'USDC' as const,
      address: TEST_RECEIVER_ADDRESS,
      amount: new BigNumber(1)
    }];
    await expect(paymentMaker.makePayment(destinations, 'test memo')).rejects.toThrow('User operation failed');
  });

  it('should handle zero amount payments', async () => {
    const permission = mockSpendPermission();
    const bundlerClient = mockBundlerClient();
    const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

    // Setup mock for prepareSpendCallData
    const { prepareSpendCallData } = await import('./spendPermissionShim.js');
    (prepareSpendCallData as any).mockResolvedValue([
      { to: USDC_CONTRACT_ADDRESS_WORLD_MAINNET, data: '0xmockencodeddata', value: 0n }
    ]);

    const paymentMaker = createTestWorldchainPaymentMaker(permission, smartWallet);

    // Make zero amount payment
    const destinations = [{
      chain: 'world' as const,
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
      { to: USDC_CONTRACT_ADDRESS_WORLD_MAINNET, data: '0xmockencodeddata', value: 0n }
    ]);

    const paymentMaker = createTestWorldchainPaymentMaker(permission, smartWallet);

    // Test various fractional amounts
    const testCases = [
      { input: new BigNumber('0.000001'), expected: 1n }, // 1 micro USDC
      { input: new BigNumber('0.1'), expected: 100000n }, // 0.1 USDC
      { input: new BigNumber('1.123456'), expected: 1123456n }, // 1.123456 USDC
      { input: new BigNumber('999.999999'), expected: 999999999n }, // 999.999999 USDC
    ];

    for (const testCase of testCases) {
      vi.clearAllMocks();

      const destinations = [{
        chain: 'world' as const,
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
});