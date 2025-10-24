// Mock viem before imports
vi.mock('viem', () => ({
  encodeFunctionData: vi.fn(() => '0xmocktransferdata'),
  toHex: vi.fn((str) => '0x' + Buffer.from(str).toString('hex')),
  fromHex: vi.fn((hex) => Buffer.from(hex.slice(2), 'hex').toString())
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainWalletPaymentMaker } from './mainWalletPaymentMaker.js';
import BigNumber from 'bignumber.js';
import { TEST_WALLET_ADDRESS, TEST_RECEIVER_ADDRESS, mockProvider } from './testHelpers.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';

const { encodeFunctionData, fromHex } = await import('viem');

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

      // Should return JWT format (header.payload.signature)
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
      expect(payload).toMatchObject({
        sub: TEST_WALLET_ADDRESS,
        iss: 'accounts.atxp.ai',
        aud: 'https://auth.atxp.ai',
        payment_request_id: 'test-payment-id',
        code_challenge: 'test-challenge'
      });
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.nonce).toBeUndefined();
      expect(payload.msg).toContain('PayMCP Authorization Request');
      
      // Decode JWT signature
      const signature = Buffer.from(parts[2], 'base64url').toString();
      expect(signature).toBe(mockSignature);
    });

    it('should generate JWT without optional fields', async () => {
      const mockSignature = '0xmocksignature';
      provider.request.mockResolvedValueOnce(mockSignature);

      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: '',
        codeChallenge: ''
      });

      // Should return JWT format without optional fields
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);
      
      // Decode JWT payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload).toMatchObject({
        sub: TEST_WALLET_ADDRESS,
        iss: 'accounts.atxp.ai',
        aud: 'https://auth.atxp.ai'
      });
      expect(payload.code_challenge).toBeUndefined();
      expect(payload.payment_request_id).toBeUndefined();
      
      // Decode JWT signature
      const signature = Buffer.from(parts[2], 'base64url').toString();
      expect(signature).toBe(mockSignature);
    });

    it('should construct message in correct format', async () => {
      const mockSignature = '0xmocksignature';
      let capturedMessage = '';
      
      provider.request.mockImplementation(async ({ method, params }) => {
        if (method === 'personal_sign' && params) {
          capturedMessage = params[0];
          return mockSignature;
        }
        throw new Error(`Unexpected method: ${method}`);
      });

      await paymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // Since mock provider doesn't have isCoinbaseWallet, it should pass plain string
      // Verify exact message format (no nonce)
      expect(capturedMessage).toContain('PayMCP Authorization Request\n\n');
      expect(capturedMessage).toContain(`Wallet: ${TEST_WALLET_ADDRESS}`);
      expect(capturedMessage).toContain('Timestamp: ');
      expect(capturedMessage).toContain('Code Challenge: test-challenge');
      expect(capturedMessage).toContain('Payment Request ID: test-payment-id');
      expect(capturedMessage).toContain('\n\n\nSign this message to prove you control this wallet.');
      // Should NOT contain nonce
      expect(capturedMessage).not.toContain('Nonce: ');
    });

    it('should handle signature errors', async () => {
      provider.request.mockRejectedValueOnce(new Error('User rejected signature'));

      await expect(
        paymentMaker.generateJWT({
          paymentRequestId: 'test',
          codeChallenge: 'test'
        })
      ).rejects.toThrow('User rejected signature');
    });

    it('should use hex encoding for Coinbase Wallet', async () => {
      const mockSignature = '0xmocksignature';
      let capturedMessage = '';
      
      // Create a provider that identifies as Coinbase Wallet
      const coinbaseProvider = {
        ...provider,
        isCoinbaseWallet: true,
        request: vi.fn(async ({ method, params }) => {
          if (method === 'personal_sign' && params) {
            capturedMessage = params[0];
            return mockSignature;
          }
          throw new Error(`Unexpected method: ${method}`);
        })
      };
      
      const coinbasePaymentMaker = new MainWalletPaymentMaker(TEST_WALLET_ADDRESS, coinbaseProvider);

      await coinbasePaymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // Should pass hex-encoded message for Coinbase Wallet
      expect(capturedMessage).toMatch(/^0x[0-9a-fA-F]+$/);
      
      // Decode and verify content
      const decodedMessage = fromHex(capturedMessage as `0x${string}`, 'string');
      expect(decodedMessage).toContain('PayMCP Authorization Request');
      expect(decodedMessage).toContain(`Wallet: ${TEST_WALLET_ADDRESS}`);
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

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1.5)
      }];

      const result = await paymentMaker.makePayment(destinations, 'Test payment');

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

      expect(result).not.toBeNull();
      expect(result!.transactionId).toBe(txHash);
      expect(result!.chain).toBe('base');
    });

    it('should throw error for non-USDC currency', async () => {
      const destinations = [{
        chain: 'base' as const,
        currency: 'ETH' as any,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await expect(
        paymentMaker.makePayment(destinations, 'Test payment')
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

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await expect(
        paymentMaker.makePayment(destinations, 'Test payment')
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

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(0.123456)
      }];

      await paymentMaker.makePayment(destinations, 'Test payment');

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

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await paymentMaker.makePayment(destinations, 'Test payment');

      // Should poll for block number until we have 2 confirmations
      expect(provider.request).toHaveBeenCalledWith({
        method: 'eth_blockNumber',
        params: []
      });
    });

    it('should verify all blockchain calls are made in correct order', async () => {
      const txHash = '0xtxhash';
      const receipt = {
        status: '0x1',
        blockNumber: '0x100'
      };

      const callOrder: string[] = [];
      provider.request.mockImplementation(async ({ method }) => {
        callOrder.push(method);
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        if (method === 'eth_blockNumber') return '0x102';
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await paymentMaker.makePayment(destinations, 'Test payment');

      // Verify correct order of calls
      expect(callOrder).toEqual([
        'eth_sendTransaction',
        'eth_getTransactionReceipt',
        'eth_blockNumber'
      ]);

      // Verify encode function data was called before send
      expect(encodeFunctionData).toHaveBeenCalledBefore(provider.request as any);
    });

    it('should handle receipt polling timeout', async () => {
      const txHash = '0xtxhash';
      
      provider.request.mockImplementation(async ({ method }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return null; // Transaction not mined yet
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      // This should eventually timeout (in real implementation)
      // For now, it will keep polling - we should add a timeout mechanism
      const promise = paymentMaker.makePayment(destinations, 'Test payment');

      // Wait a bit and then provide a receipt
      setTimeout(() => {
        provider.request.mockImplementation(async ({ method }) => {
          if (method === 'eth_getTransactionReceipt') {
            return { status: '0x1', blockNumber: '0x100' };
          }
          if (method === 'eth_blockNumber') return '0x102';
          throw new Error(`Unexpected method: ${method}`);
        });
      }, 100);

      const result = await promise;
      expect(result).not.toBeNull();
      expect(result!.transactionId).toBe(txHash);
    });

    it('should handle transaction submission errors', async () => {
      provider.request.mockRejectedValueOnce(new Error('insufficient funds'));

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await expect(
        paymentMaker.makePayment(destinations, 'Test payment')
      ).rejects.toThrow('insufficient funds');

      // Should have attempted to send transaction
      expect(provider.request).toHaveBeenCalledWith({
        method: 'eth_sendTransaction',
        params: expect.any(Array)
      });
    });

    it('should handle large amounts correctly', async () => {
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

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1000000) // 1 million USDC
      }];

      await paymentMaker.makePayment(destinations, 'Test payment');

      // Should handle large amounts correctly
      expect(encodeFunctionData).toHaveBeenCalledWith({
        abi: expect.any(Array),
        functionName: 'transfer',
        args: [TEST_RECEIVER_ADDRESS, 1000000000000n] // 1M USDC = 1,000,000,000,000 units
      });
    });
  });

  describe('error handling', () => {
    it('should handle provider errors gracefully', async () => {
      provider.request.mockRejectedValue(new Error('Provider disconnected'));

      await expect(
        paymentMaker.generateJWT({
          paymentRequestId: 'test',
          codeChallenge: 'test'
        })
      ).rejects.toThrow('Provider disconnected');
    });

    it('should handle invalid addresses', async () => {
      const invalidAddress = '0xinvalid';
      
      provider.request.mockImplementation(async ({ method, params }) => {
        if (method === 'eth_sendTransaction' && params?.[0]?.to === USDC_CONTRACT_ADDRESS_BASE) {
          throw new Error('invalid address');
        }
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'base' as const,
        currency: 'USDC' as const,
        address: invalidAddress,
        amount: new BigNumber(1)
      }];

      await expect(
        paymentMaker.makePayment(destinations, 'Test payment')
      ).rejects.toThrow();
    });
  });
});