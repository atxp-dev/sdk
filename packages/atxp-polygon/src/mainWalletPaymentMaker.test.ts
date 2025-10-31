// Mock viem before imports
vi.mock('viem', () => ({
  encodeFunctionData: vi.fn(() => '0xmocktransferdata'),
  toHex: vi.fn((str) => '0x' + Buffer.from(str).toString('hex')),
  fromHex: vi.fn((hex) => Buffer.from(hex.slice(2), 'hex').toString())
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectWalletPaymentMaker } from './directWalletPaymentMaker.js';
import BigNumber from 'bignumber.js';
import { TEST_WALLET_ADDRESS, TEST_RECEIVER_ADDRESS, mockProvider, mockLogger, type MockEip1193Provider } from './testHelpers.js';
import { getPolygonUSDCAddress } from '@atxp/client';

const { encodeFunctionData, fromHex } = await import('viem');

describe('DirectWalletPaymentMaker', () => {
  let provider: MockEip1193Provider;
  let logger: ReturnType<typeof mockLogger>;
  let paymentMaker: DirectWalletPaymentMaker;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = mockProvider();
    logger = mockLogger();
    paymentMaker = new DirectWalletPaymentMaker(TEST_WALLET_ADDRESS, provider, logger, 137);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateJWT', () => {
    it('should generate JWT with wallet signature', async () => {
      // Valid ECDSA signature format: 65 bytes = 130 hex chars (r=32 bytes, s=32 bytes, v=1 byte)
      const mockSignature = '0x' + 'a'.repeat(64) + 'b'.repeat(64) + '1b';
      provider.request.mockResolvedValueOnce(mockSignature);

      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // Should request personal_sign with JWT message (header.payload)
      expect(provider.request).toHaveBeenCalledWith({
        method: 'personal_sign',
        params: [
          expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
          TEST_WALLET_ADDRESS
        ]
      });

      // Should return JWT format (header.payload.signature)
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      // Decode JWT header
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      expect(header).toEqual({
        alg: 'ES256K',
        typ: 'JWT'
      });

      // Decode JWT payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload).toMatchObject({
        sub: TEST_WALLET_ADDRESS,
        iss: 'atxp.ai',
        aud: 'https://auth.atxp.ai',
        payment_request_id: 'test-payment-id',
        code_challenge: 'test-challenge'
      });
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();

      // Verify signature is present and properly encoded (should be 65 bytes base64url encoded)
      expect(parts[2].length).toBeGreaterThan(0);
    });

    it('should generate JWT without optional fields', async () => {
      // Valid ECDSA signature format: 65 bytes = 130 hex chars (r=32 bytes, s=32 bytes, v=1 byte)
      const mockSignature = '0x' + 'a'.repeat(64) + 'b'.repeat(64) + '1b';
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
        iss: 'atxp.ai',
        aud: 'https://auth.atxp.ai'
      });
      expect(payload.code_challenge).toBeUndefined();
      expect(payload.payment_request_id).toBeUndefined();

      // Verify signature is present and properly encoded
      expect(parts[2].length).toBeGreaterThan(0);
    });

    it('should construct message in correct format', async () => {
      // Valid ECDSA signature format: 65 bytes = 130 hex chars (r=32 bytes, s=32 bytes, v=1 byte)
      const mockSignature = '0x' + 'a'.repeat(64) + 'b'.repeat(64) + '1b';
      let capturedMessage = '';

      provider.request.mockImplementation(async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'personal_sign' && params) {
          capturedMessage = params[0] as string;
          return mockSignature;
        }
        throw new Error(`Unexpected method: ${method}`);
      });

      await paymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // Verify JWT message format (header.payload)
      expect(capturedMessage).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      // Decode and verify the parts
      const parts = capturedMessage.split('.');
      expect(parts).toHaveLength(2);

      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      expect(header.alg).toBe('ES256K');
      expect(header.typ).toBe('JWT');

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload.sub).toBe(TEST_WALLET_ADDRESS);
      expect(payload.payment_request_id).toBe('test-payment-id');
      expect(payload.code_challenge).toBe('test-challenge');
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

    it('should generate JWT with standard format (no special Coinbase handling)', async () => {
      // Valid ECDSA signature format: 65 bytes = 130 hex chars (r=32 bytes, s=32 bytes, v=1 byte)
      const mockSignature = '0x' + 'a'.repeat(64) + 'b'.repeat(64) + '1b';
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

      const coinbasePaymentMaker = new DirectWalletPaymentMaker(
        TEST_WALLET_ADDRESS,
        coinbaseProvider,
        mockLogger(),
        137
      );

      await coinbasePaymentMaker.generateJWT({
        paymentRequestId: 'test-payment-id',
        codeChallenge: 'test-challenge'
      });

      // Should use standard JWT message format (header.payload) - no special Coinbase encoding
      expect(capturedMessage).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      // Decode and verify content
      const parts = capturedMessage.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload.sub).toBe(TEST_WALLET_ADDRESS);
      expect(payload.payment_request_id).toBe('test-payment-id');
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
      provider.request.mockImplementation(async ({ method }: { method: string }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        if (method === 'eth_blockNumber') return '0x102'; // 2 blocks after receipt
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'polygon' as const,
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
          to: getPolygonUSDCAddress(137),
          data: '0xmocktransferdata',
          value: '0x0'
        }]
      });

      expect(result).not.toBeNull();
      expect(result!.transactionId).toBe(txHash);
      expect(result!.chain).toBe('polygon');
    });

    it('should throw error for non-USDC currency', async () => {
      const destinations = [{
        chain: 'polygon' as const,
        currency: 'ETH' as any,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await expect(paymentMaker.makePayment(destinations, 'Test payment')).rejects.toThrow(
        'Only usdc currency is supported'
      );
    });

    it('should throw error if transaction fails', async () => {
      const txHash = '0xtxhash';
      const receipt = {
        status: '0x0', // Failed transaction
        blockNumber: '0x100'
      };

      provider.request.mockImplementation(async ({ method }: { method: string }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await expect(paymentMaker.makePayment(destinations, 'Test payment')).rejects.toThrow(
        `Transaction failed. TxHash: ${txHash}`
      );
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
        chain: 'polygon' as const,
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
      provider.request.mockImplementation(async ({ method }: { method: string }) => {
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
        chain: 'polygon' as const,
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
      provider.request.mockImplementation(async ({ method }: { method: string }) => {
        callOrder.push(method);
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        if (method === 'eth_blockNumber') return '0x102';
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await paymentMaker.makePayment(destinations, 'Test payment');

      // Verify correct order of calls
      expect(callOrder).toEqual(['eth_sendTransaction', 'eth_getTransactionReceipt', 'eth_blockNumber']);

      // Verify encode function data was called before send
      expect(encodeFunctionData).toHaveBeenCalledBefore(provider.request as any);
    });

    it('should handle transaction submission errors', async () => {
      provider.request.mockRejectedValueOnce(new Error('insufficient funds'));

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: TEST_RECEIVER_ADDRESS,
        amount: new BigNumber(1)
      }];

      await expect(paymentMaker.makePayment(destinations, 'Test payment')).rejects.toThrow(
        'insufficient funds'
      );

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

      provider.request.mockImplementation(async ({ method }: { method: string }) => {
        if (method === 'eth_sendTransaction') return txHash;
        if (method === 'eth_getTransactionReceipt') return receipt;
        if (method === 'eth_blockNumber') return '0x102';
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'polygon' as const,
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

      provider.request.mockImplementation(async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_sendTransaction' && (params?.[0] as any)?.to === getPolygonUSDCAddress(137)) {
          throw new Error('invalid address');
        }
        throw new Error(`Unexpected method: ${method}`);
      });

      const destinations = [{
        chain: 'polygon' as const,
        currency: 'USDC' as const,
        address: invalidAddress,
        amount: new BigNumber(1)
      }];

      await expect(paymentMaker.makePayment(destinations, 'Test payment')).rejects.toThrow();
    });
  });
});
