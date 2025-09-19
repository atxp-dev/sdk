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

import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import BigNumber from 'bignumber.js';
import {
  mockSpendPermission,
  mockEphemeralSmartWallet,
  mockBundlerClient,
  mockFailedBundlerClient,
  TEST_RECEIVER_ADDRESS
} from './testHelpers.js';

describe('basePaymentMaker.generateJWT', () => {
  it('should generate EIP-1271 auth data with default payload', async () => {
    const permission = mockSpendPermission();
    const smartWallet = mockEphemeralSmartWallet();
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
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
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
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

describe('baseAppPaymentMaker.makePayment', () => {
  it('should successfully make a USDC payment', async () => {
    const permission = mockSpendPermission();
    const bundlerClient = mockBundlerClient();
    const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });

    // Setup mock for prepareSpendCallData
    const { prepareSpendCallData } = await import('./spendPermissionShim.js');
    (prepareSpendCallData as any).mockResolvedValue([
      { to: USDC_CONTRACT_ADDRESS_BASE, data: '0xmockencodeddata', value: 0n }
    ]);

    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const amount = new BigNumber(1.5); // 1.5 USDC

    const txHash = await paymentMaker.makePayment(amount, 'USDC', TEST_RECEIVER_ADDRESS, 'test payment');
    
    // Verify the transaction hash
    expect(txHash).toBe('0xtxhash');
    
    // Verify sendUserOperation was called with correct parameters
    expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
      account: smartWallet.account,
      calls: expect.arrayContaining([
        {
          to: USDC_CONTRACT_ADDRESS_BASE,
          data: expect.any(String), // Contains encoded transferFrom + memo
          value: 0n
        }
      ]),
      maxPriorityFeePerGas: expect.any(BigInt)
    });

    // Verify prepareSpendCallData was called with correct parameters
    expect(prepareSpendCallData).toHaveBeenCalledWith({
      permission: permission,
      amount: 1500000n // 1.5 USDC in smallest units
    });
    
    // Verify waitForUserOperationReceipt was called
    expect(bundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({ hash: '0xoperationhash' });
  });

  it('should throw error for non-USDC currency', async () => {
    const permission = mockSpendPermission();
    const smartWallet = mockEphemeralSmartWallet();
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const amount = new BigNumber(1.5);
    
    await expect(
      paymentMaker.makePayment(amount, 'ETH' as any, TEST_RECEIVER_ADDRESS, 'test payment')
    ).rejects.toThrow('Only usdc currency is supported');
  });

  it('should throw error if user operation fails', async () => {
    const permission = mockSpendPermission();
    const bundlerClient = mockFailedBundlerClient({ failureType: 'receipt' });
    const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const amount = new BigNumber(1.5);
    
    await expect(
      paymentMaker.makePayment(amount, 'USDC', TEST_RECEIVER_ADDRESS, 'test payment')
    ).rejects.toThrow('User operation failed');
  });

  it('should throw error if transaction hash is not returned', async () => {
    const permission = mockSpendPermission();
    const bundlerClient = mockFailedBundlerClient({ failureType: 'noTxHash' });
    const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const amount = new BigNumber(1.5);
    
    await expect(
      paymentMaker.makePayment(amount, 'USDC', TEST_RECEIVER_ADDRESS, 'test payment')
    ).rejects.toThrow('User operation was executed but no transaction hash was returned');
  });
});

