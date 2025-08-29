import { describe, it, expect, vi } from 'vitest';

// Mock all external modules before imports
vi.mock('@base-org/account/spend-permission', () => ({
  prepareSpendCallData: vi.fn()
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    encodeFunctionData: vi.fn(() => '0xmockencodeddata')
  };
});

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
import type { SpendPermission } from './types.js';
import type { EphemeralSmartWallet } from './smartWalletHelpers.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import BigNumber from 'bignumber.js';
import { 
  setupPaymentMocks,
  mockSpendPermission,
  mockEphemeralSmartWallet,
  mockBundlerClient,
  mockFailedBundlerClient,
  mockSpendCalls,
  TEST_RECEIVER_ADDRESS
} from './testHelpers.js';

describe('basePaymentMaker.generateJWT', () => {
  it('should generate EIP-1271 auth data with default payload', async () => {
    const permission = mockSpendPermission();
    const smartWallet = mockEphemeralSmartWallet();
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const authData = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: 'testCodeChallenge'});

    // Should return base64-encoded EIP-1271 auth data
    expect(authData).toBeDefined();
    expect(typeof authData).toBe('string');
    
    // Decode and verify the auth data
    const decoded = JSON.parse(Buffer.from(authData, 'base64').toString('utf-8'));
    expect(decoded.type).toBe('EIP1271_AUTH');
    expect(decoded.walletAddress).toBe(smartWallet.address);
    expect(decoded.message).toContain('PayMCP Authorization Request');
    expect(decoded.signature).toBeDefined();
    expect(decoded.timestamp).toBeDefined();
    expect(decoded.nonce).toBeDefined();
    expect(decoded.code_challenge).toBe('testCodeChallenge');
  });

  it('should include payment request id if provided', async () => {
    const permission = mockSpendPermission();
    const smartWallet = mockEphemeralSmartWallet();
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const paymentRequestId = 'id1';
    const authData = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: ''});
    
    // Decode and verify the auth data includes payment request ID
    const decoded = JSON.parse(Buffer.from(authData, 'base64').toString('utf-8'));
    expect(decoded.payment_request_id).toEqual(paymentRequestId);
    expect(decoded.message).toContain(`Payment Request ID: ${paymentRequestId}`);
  });
});

describe('baseAppPaymentMaker.makePayment', () => {
  it('should successfully make a USDC payment', async () => {
    const permission = mockSpendPermission();
    const bundlerClient = mockBundlerClient();
    const smartWallet = mockEphemeralSmartWallet({ client: bundlerClient });
    const spendCalls = mockSpendCalls();
    
    const { prepareSpendCallData } = await setupPaymentMocks({ spendCalls });
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const amount = new BigNumber(1.5); // 1.5 USDC
    
    const txHash = await paymentMaker.makePayment(amount, 'USDC', TEST_RECEIVER_ADDRESS, 'test payment');
    
    // Verify the transaction hash
    expect(txHash).toBe('0xtxhash');
    
    // Verify prepareSpendCallData was called with correct amount
    expect(prepareSpendCallData).toHaveBeenCalledWith(permission, 1500000n); // 1.5 USDC = 1,500,000 in smallest units
    
    // Verify sendUserOperation was called with correct parameters
    expect(bundlerClient.sendUserOperation).toHaveBeenCalledWith({
      account: smartWallet.account,
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
    
    await setupPaymentMocks({ spendCalls: [] });
    
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
    
    await setupPaymentMocks({ spendCalls: [] });
    
    const paymentMaker = new BaseAppPaymentMaker(permission, smartWallet);
    const amount = new BigNumber(1.5);
    
    await expect(
      paymentMaker.makePayment(amount, 'USDC', TEST_RECEIVER_ADDRESS, 'test payment')
    ).rejects.toThrow('User operation was executed but no transaction hash was returned');
  });
});

