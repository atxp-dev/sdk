// Mock viem before imports
vi.mock('viem', () => ({
  encodeFunctionData: vi.fn(() => '0xmocktransferdata')
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainWalletPaymentMaker } from './mainWalletPaymentMaker.js';
import BigNumber from 'bignumber.js';
import { TEST_WALLET_ADDRESS, TEST_RECEIVER_ADDRESS, mockProvider } from './testHelpers.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';

const { encodeFunctionData } = await import('viem');

describe('MainWalletPaymentMaker', () => {
  let provider: ReturnType<typeof mockProvider>;
  let paymentMaker: MainWalletPaymentMaker;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = mockProvider();
    paymentMaker = new MainWalletPaymentMaker(TEST_WALLET_ADDRESS, provider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateJWT', () => {
    it('should generate JWT with wallet signature', async () => {
      const mockSignature = '0xmocksignature';
      provider.request.mockResolvedValueOnce(mockSignature);

      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // Should request personal_sign
      expect(provider.request).toHaveBeenCalledWith({
        method: 'personal_sign',
        params: [
          expect.stringContaining('PayMCP Authorization Request'),
          TEST_WALLET_ADDRESS
        ]
      });

      // Should return base64url encoded JWT
      // Decode base64url
      const base64 = jwt.replace(/-/g, '+').replace(/_/g, '/');
      const padding = '='.repeat((4 - base64.length % 4) % 4);
      const decodedJwt = JSON.parse(Buffer.from(base64 + padding, 'base64').toString());
      
      expect(decodedJwt).toMatchObject({
        type: 'EIP1271_AUTH',
        walletAddress: TEST_WALLET_ADDRESS,
        signature: mockSignature,
        payment_request_id: 'test-payment-id',
        code_challenge: 'test-challenge'
      });
      expect(decodedJwt.timestamp).toBeDefined();
      expect(decodedJwt.nonce).toBeDefined();
      expect(decodedJwt.message).toContain('PayMCP Authorization Request');
    });

    it('should generate JWT without optional fields', async () => {
      const mockSignature = '0xmocksignature';
      provider.request.mockResolvedValueOnce(mockSignature);

      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: '',
        codeChallenge: ''
      });

      // Decode base64url
      const base64 = jwt.replace(/-/g, '+').replace(/_/g, '/');
      const padding = '='.repeat((4 - base64.length % 4) % 4);
      const decodedJwt = JSON.parse(Buffer.from(base64 + padding, 'base64').toString());
      
      expect(decodedJwt.type).toBe('EIP1271_AUTH');
      expect(decodedJwt.payment_request_id).toBeUndefined();
      expect(decodedJwt.code_challenge).toBeUndefined();
    });
  });

  describe('makePayment', () => {
    it('should make USDC payment through main wallet', async () => {
      const txHash = '0xtxhash';
      const receipt = {
        status: '0x1',
        blockNumber: '0x100'
      };
      
      // Mock transaction submission
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        if (method === 'eth_blockNumber') return '0x102'; // 2 blocks after receipt
        throw new Error(`Unexpected method: ${method}`);
      });

      const result = await paymentMaker.makePayment(
        new BigNumber(1.5),
        'USDC',
        TEST_RECEIVER_ADDRESS,
        'Test payment'
      );

      // Should encode transfer function
      expect(encodeFunctionData).toHaveBeenCalledWith({
        abi: expect.any(Array),
        functionName: 'transfer',
        args: [TEST_RECEIVER_ADDRESS, 1500000n] // 1.5 USDC = 1,500,000 units
      });

      // Should send transaction
      expect(provider.request).toHaveBeenCalledWith({
        method: 'eth_sendTransaction',
        params: [{
          from: TEST_WALLET_ADDRESS,
          to: USDC_CONTRACT_ADDRESS_BASE,
          data: '0xmocktransferdata',
          value: '0x0'
        }]
      });

      expect(result).toBe(txHash);
    });

    it('should throw error for non-USDC currency', async () => {
      await expect(
        paymentMaker.makePayment(
          new BigNumber(1),
          'ETH' as any,
          TEST_RECEIVER_ADDRESS,
          'Test payment'
        )
      ).rejects.toThrow('Only usdc currency is supported');
    });

    it('should throw error if transaction fails', async () => {
      const txHash = '0xtxhash';
      const receipt = {
        status: '0x0', // Failed transaction
        blockNumber: '0x100'
      };
      
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        throw new Error(`Unexpected method: ${method}`);
      });

      await expect(
        paymentMaker.makePayment(
          new BigNumber(1),
          'USDC',
          TEST_RECEIVER_ADDRESS,
          'Test payment'
        )
      ).rejects.toThrow(`Transaction failed. TxHash: ${txHash}`);
    });

    it('should handle decimal amounts correctly', async () => {
      const txHash = '0xtxhash';
      const receipt = {
        status: '0x1',
        blockNumber: '0x100'
      };
      
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        if (method === 'eth_blockNumber') return '0x102';
        throw new Error(`Unexpected method: ${method}`);
      });

      await paymentMaker.makePayment(
        new BigNumber(0.123456),
        'USDC',
        TEST_RECEIVER_ADDRESS,
        'Test payment'
      );

      // Should round to 6 decimals for USDC
      expect(encodeFunctionData).toHaveBeenCalledWith({
        abi: expect.any(Array),
        functionName: 'transfer',
        args: [TEST_RECEIVER_ADDRESS, 123456n] // 0.123456 USDC = 123,456 units
      });
    });

    it('should wait for confirmations', async () => {
      const txHash = '0xtxhash';
      const receipt = {
        status: '0x1',
        blockNumber: '0x100' // Block 256
      };
      
      let blockNumberCalls = 0;
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        if (method === 'eth_blockNumber') {
          blockNumberCalls++;
          // Return increasing block numbers
          return blockNumberCalls === 1 ? '0x100' : '0x101'; // Need 2 confirmations
        }
        throw new Error(`Unexpected method: ${method}`);
      });

      await paymentMaker.makePayment(
        new BigNumber(1),
        'USDC',
        TEST_RECEIVER_ADDRESS,
        'Test payment'
      );

      // Should poll for block number until we have 2 confirmations
      expect(provider.request).toHaveBeenCalledWith({
        method: 'eth_blockNumber',
        params: []
      });
    });
  });
});
