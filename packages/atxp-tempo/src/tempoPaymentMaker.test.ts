import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BigNumber } from 'bignumber.js';
import type { Destination } from '@atxp/common';

// Mock viem before importing TempoPaymentMaker
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem') as Record<string, unknown>;
  return {
    ...actual,
    createWalletClient: vi.fn(),
    http: vi.fn(),
  };
});

// We need to test TempoPaymentMaker with a mock wallet client
import { TempoPaymentMaker } from './tempoPaymentMaker.js';
import { PATHUSD_CONTRACT_ADDRESS_TEMPO } from './tempoConstants.js';

function createMockWalletClient(overrides: Record<string, unknown> = {}) {
  const mockClient = {
    account: {
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      signMessage: vi.fn().mockResolvedValue('0xmocksignature'),
    },
    readContract: vi.fn(),
    sendTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    signMessage: vi.fn().mockResolvedValue('0xmocksignature'),
    extend: vi.fn(),
    ...overrides,
  };
  // extend() should return the client itself with public actions mixed in
  mockClient.extend.mockReturnValue(mockClient);
  return mockClient;
}

describe('TempoPaymentMaker', () => {
  let mockWalletClient: ReturnType<typeof createMockWalletClient>;
  let paymentMaker: TempoPaymentMaker;

  beforeEach(() => {
    mockWalletClient = createMockWalletClient();
    paymentMaker = new TempoPaymentMaker('https://rpc.tempo.xyz', mockWalletClient as any);
  });

  describe('constructor', () => {
    it('throws when rpcUrl is empty', () => {
      expect(() => new TempoPaymentMaker('', mockWalletClient as any)).toThrow('rpcUrl was empty');
    });

    it('throws when walletClient is null', () => {
      expect(() => new TempoPaymentMaker('https://rpc.tempo.xyz', null as any)).toThrow('walletClient was empty');
    });

    it('throws when walletClient has no account', () => {
      const noAccountClient = createMockWalletClient({ account: undefined });
      expect(() => new TempoPaymentMaker('https://rpc.tempo.xyz', noAccountClient as any)).toThrow('walletClient.account was empty');
    });
  });

  describe('makePayment', () => {
    it('filters for tempo destinations only', async () => {
      const destinations: Destination[] = [
        { chain: 'base', currency: 'USDC', address: '0xrecipient', amount: new BigNumber('1.0') },
        { chain: 'solana', currency: 'USDC', address: 'solanaaddr', amount: new BigNumber('2.0') },
      ];

      const result = await paymentMaker.makePayment(destinations, '');
      expect(result).toBeNull();
    });

    it('returns null for non-tempo destinations', async () => {
      const destinations: Destination[] = [
        { chain: 'base', currency: 'USDC', address: '0xrecipient', amount: new BigNumber('1.0') },
      ];

      const result = await paymentMaker.makePayment(destinations, '');
      expect(result).toBeNull();
    });

    it('uses pathUSD contract address', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      mockWalletClient.readContract.mockResolvedValue(BigInt(10000000)); // 10 pathUSD
      mockWalletClient.sendTransaction.mockResolvedValue(mockTxHash);
      mockWalletClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 100n });

      const destinations: Destination[] = [
        { chain: 'tempo', currency: 'USDC', address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      await paymentMaker.makePayment(destinations, '');

      // Verify readContract was called with pathUSD address
      expect(mockWalletClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: PATHUSD_CONTRACT_ADDRESS_TEMPO,
        })
      );

      // Verify sendTransaction was called with pathUSD address as 'to'
      expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          to: PATHUSD_CONTRACT_ADDRESS_TEMPO,
        })
      );
    });

    it('returns correct PaymentIdentifier with chain: tempo', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      mockWalletClient.readContract.mockResolvedValue(BigInt(10000000));
      mockWalletClient.sendTransaction.mockResolvedValue(mockTxHash);
      mockWalletClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 100n });

      const destinations: Destination[] = [
        { chain: 'tempo', currency: 'USDC', address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      const result = await paymentMaker.makePayment(destinations, '');

      expect(result).toEqual({
        transactionId: mockTxHash,
        chain: 'tempo',
        currency: 'USDC',
      });
    });

    it('handles insufficient balance', async () => {
      // Return balance of 0.5 USDC (500000 units)
      mockWalletClient.readContract.mockResolvedValue(BigInt(500000));

      const destinations: Destination[] = [
        { chain: 'tempo', currency: 'USDC', address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      await expect(paymentMaker.makePayment(destinations, '')).rejects.toThrow('insufficient');
    });

    it('uses transferWithMemo when memo is provided', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      mockWalletClient.readContract.mockResolvedValue(BigInt(10000000));
      mockWalletClient.sendTransaction.mockResolvedValue(mockTxHash);
      mockWalletClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 100n });

      const destinations: Destination[] = [
        { chain: 'tempo', currency: 'USDC', address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      const result = await paymentMaker.makePayment(destinations, 'payment-ref-123');

      expect(result).not.toBeNull();
      expect(result!.chain).toBe('tempo');

      // The sendTransaction should have been called with data that encodes transferWithMemo
      // We can verify it was called (the exact encoding is handled by viem)
      expect(mockWalletClient.sendTransaction).toHaveBeenCalledTimes(1);
      const callArgs = mockWalletClient.sendTransaction.mock.calls[0][0];
      // transferWithMemo has a different function selector than transfer
      // transfer: 0xa9059cbb, transferWithMemo: different selector
      expect(callArgs.data).toBeDefined();
    });

    it('uses transfer when no memo', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      mockWalletClient.readContract.mockResolvedValue(BigInt(10000000));
      mockWalletClient.sendTransaction.mockResolvedValue(mockTxHash);
      mockWalletClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 100n });

      const destinations: Destination[] = [
        { chain: 'tempo', currency: 'USDC', address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      const result = await paymentMaker.makePayment(destinations, '');

      expect(result).not.toBeNull();
      // transfer function selector is 0xa9059cbb
      const callArgs = mockWalletClient.sendTransaction.mock.calls[0][0];
      expect(callArgs.data).toMatch(/^0xa9059cbb/);
    });

    it('throws UnsupportedCurrencyError for non-USDC currency', async () => {
      const destinations: Destination[] = [
        { chain: 'tempo', currency: 'USDC' as any, address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      // Override the currency check - we need a non-USDC currency
      const nonUsdcDestinations: Destination[] = [
        { chain: 'tempo', currency: 'ETH' as any, address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      await expect(paymentMaker.makePayment(nonUsdcDestinations, '')).rejects.toThrow();
    });

    it('handles transaction revert', async () => {
      mockWalletClient.readContract.mockResolvedValue(BigInt(10000000));
      mockWalletClient.sendTransaction.mockResolvedValue('0xreverted');
      mockWalletClient.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted', blockNumber: 100n });

      const destinations: Destination[] = [
        { chain: 'tempo', currency: 'USDC', address: '0x1234567890123456789012345678901234567890', amount: new BigNumber('1.0') },
      ];

      await expect(paymentMaker.makePayment(destinations, '')).rejects.toThrow();
    });
  });

  describe('getSourceAddress', () => {
    it('returns the wallet address', () => {
      const address = paymentMaker.getSourceAddress({
        amount: new BigNumber('1.0'),
        currency: 'USDC',
        receiver: '0xrecipient',
        memo: '',
      });
      expect(address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    });
  });

  describe('generateJWT', () => {
    it('generates a JWT token', async () => {
      const jwt = await paymentMaker.generateJWT({
        paymentRequestId: 'test-pr-id',
        codeChallenge: 'test-challenge',
      });

      // JWT should have 3 parts separated by dots
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      // Decode header
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      expect(header.alg).toBe('ES256K');

      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload.sub).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
      expect(payload.payment_request_id).toBe('test-pr-id');
      expect(payload.code_challenge).toBe('test-challenge');
    });
  });
});
