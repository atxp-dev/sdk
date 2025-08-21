import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SolanaPaymentMaker } from './solanaPaymentMaker.js';
import { InsufficientFundsError, PaymentNetworkError } from './types.js';
import { BigNumber } from 'bignumber.js';

// Mock Solana web3.js
vi.mock('@solana/web3.js', () => ({
  Keypair: {
    fromSecretKey: vi.fn(() => ({
      publicKey: {
        toBase58: vi.fn(() => 'DummyPublicKey123'),
        toBytes: vi.fn(() => new Uint8Array(32)),
      },
      secretKey: new Uint8Array(64),
    })),
  },
  Connection: vi.fn(() => ({
    // Mock connection methods if needed
  })),
  PublicKey: vi.fn((key) => ({ toString: () => key })),
  ComputeBudgetProgram: {
    setComputeUnitLimit: vi.fn(),
    setComputeUnitPrice: vi.fn(),
  },
  sendAndConfirmTransaction: vi.fn(),
}));

// Mock Solana Pay
vi.mock('@solana/pay', () => ({
  createTransfer: vi.fn(() => ({
    add: vi.fn(),
  })),
  ValidateTransferError: class MockValidateTransferError extends Error {},
}));

// Mock SPL Token
vi.mock('@solana/spl-token', () => ({
  getAccount: vi.fn(),
  getAssociatedTokenAddress: vi.fn(),
}));

// Mock other dependencies
vi.mock('bs58', () => ({
  default: {
    decode: vi.fn(() => new Uint8Array(64)),
  },
}));

vi.mock('jose', () => ({
  importJWK: vi.fn(() => Promise.resolve(new CryptoKey())),
}));

import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { createTransfer } from '@solana/pay';
import { sendAndConfirmTransaction } from '@solana/web3.js';

describe('SolanaPaymentMaker insufficient funds handling', () => {
  let paymentMaker: SolanaPaymentMaker;
  let mockConnection: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockConnection = {
      // Mock connection methods
    };

    paymentMaker = new SolanaPaymentMaker(
      'https://fake-solana-rpc.com',
      'DummySecretKey123'
    );

    // Inject mock connection
    (paymentMaker as any).connection = mockConnection;
  });

  it('should throw InsufficientFundsError when balance is less than required', async () => {
    // Mock token account with insufficient balance (3 USDC when 10 is required)
    const mockTokenAccount = {
      amount: BigInt(3 * 1_000_000), // 3 USDC with 6 decimals
    };

    vi.mocked(getAssociatedTokenAddress).mockResolvedValue('TokenAccount123' as any);
    vi.mocked(getAccount).mockResolvedValue(mockTokenAccount as any);

    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey')
    ).rejects.toThrow(InsufficientFundsError);

    // Verify the error details
    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      
      if (error instanceof InsufficientFundsError) {
        expect(error.currency).toBe('USDC');
        expect(error.required.toString()).toBe('10');
        expect(error.available?.toString()).toBe('3');
        expect(error.network).toBe('solana');
        expect(error.message).toContain('insufficient USDC funds on solana');
        expect(error.message).toContain('Required: 10, Available: 3');
      }
    }

    // Verify balance was checked but transaction not attempted
    expect(getAssociatedTokenAddress).toHaveBeenCalled();
    expect(getAccount).toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('should proceed with payment when balance is sufficient', async () => {
    // Mock token account with sufficient balance (20 USDC when 10 is required)
    const mockTokenAccount = {
      amount: BigInt(20 * 1_000_000), // 20 USDC with 6 decimals
    };

    const mockTransaction = {
      add: vi.fn(),
    };

    vi.mocked(getAssociatedTokenAddress).mockResolvedValue('TokenAccount123' as any);
    vi.mocked(getAccount).mockResolvedValue(mockTokenAccount as any);
    vi.mocked(createTransfer).mockResolvedValue(mockTransaction as any);
    vi.mocked(sendAndConfirmTransaction).mockResolvedValue('TransactionSignature123');

    const result = await paymentMaker.makePayment(
      new BigNumber('10'), 
      'USDC', 
      'ReceiverPublicKey'
    );

    expect(result).toBe('TransactionSignature123');
    expect(getAssociatedTokenAddress).toHaveBeenCalled();
    expect(getAccount).toHaveBeenCalled();
    expect(createTransfer).toHaveBeenCalled();
    expect(sendAndConfirmTransaction).toHaveBeenCalled();
  });

  it('should throw PaymentNetworkError for unsupported currency', async () => {
    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'SOL', 'ReceiverPublicKey')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'SOL', 'ReceiverPublicKey');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNetworkError);
      
      if (error instanceof PaymentNetworkError) {
        expect(error.message).toContain('Only USDC currency is supported');
      }
    }

    // Verify balance check was not attempted
    expect(getAssociatedTokenAddress).not.toHaveBeenCalled();
  });

  it('should wrap unexpected errors in PaymentNetworkError', async () => {
    // Mock getAssociatedTokenAddress to throw unexpected error
    const unexpectedError = new Error('Network connection timeout');
    vi.mocked(getAssociatedTokenAddress).mockRejectedValue(unexpectedError);

    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNetworkError);
      
      if (error instanceof PaymentNetworkError) {
        expect(error.message).toContain('Payment failed on Solana network');
        expect(error.message).toContain('Network connection timeout');
        expect(error.originalError).toBe(unexpectedError);
      }
    }
  });

  it('should handle transaction failure after balance check', async () => {
    // Mock sufficient balance
    const mockTokenAccount = {
      amount: BigInt(15 * 1_000_000),
    };

    const mockTransaction = {
      add: vi.fn(),
    };

    vi.mocked(getAssociatedTokenAddress).mockResolvedValue('TokenAccount123' as any);
    vi.mocked(getAccount).mockResolvedValue(mockTokenAccount as any);
    vi.mocked(createTransfer).mockResolvedValue(mockTransaction as any);
    
    // Mock transaction failure
    const transactionError = new Error('Transaction failed to confirm');
    vi.mocked(sendAndConfirmTransaction).mockRejectedValue(transactionError);

    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNetworkError);
      
      if (error instanceof PaymentNetworkError) {
        expect(error.originalError).toBe(transactionError);
      }
    }
  });

  it('should handle zero balance', async () => {
    const mockTokenAccount = {
      amount: BigInt(0),
    };

    vi.mocked(getAssociatedTokenAddress).mockResolvedValue('TokenAccount123' as any);
    vi.mocked(getAccount).mockResolvedValue(mockTokenAccount as any);

    await expect(
      paymentMaker.makePayment(new BigNumber('0.000001'), 'USDC', 'ReceiverPublicKey')
    ).rejects.toThrow(InsufficientFundsError);

    try {
      await paymentMaker.makePayment(new BigNumber('0.000001'), 'USDC', 'ReceiverPublicKey');
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        expect(error.available?.toString()).toBe('0');
        expect(error.required.toString()).toBe('0.000001');
      }
    }
  });

  it('should handle exact balance match', async () => {
    // Mock exact balance (5.5 USDC when 5.5 is required)
    const mockTokenAccount = {
      amount: BigInt(5.5 * 1_000_000),
    };

    const mockTransaction = {
      add: vi.fn(),
    };

    vi.mocked(getAssociatedTokenAddress).mockResolvedValue('TokenAccount123' as any);
    vi.mocked(getAccount).mockResolvedValue(mockTokenAccount as any);
    vi.mocked(createTransfer).mockResolvedValue(mockTransaction as any);
    vi.mocked(sendAndConfirmTransaction).mockResolvedValue('TransactionSignature123');

    const result = await paymentMaker.makePayment(
      new BigNumber('5.5'),
      'USDC',
      'ReceiverPublicKey'
    );

    expect(result).toBe('TransactionSignature123');
    expect(sendAndConfirmTransaction).toHaveBeenCalled();
  });

  it('should handle token account not found error', async () => {
    vi.mocked(getAssociatedTokenAddress).mockResolvedValue('TokenAccount123' as any);
    
    // Mock getAccount to throw token account not found error
    const accountError = new Error('TokenAccountNotFoundError');
    vi.mocked(getAccount).mockRejectedValue(accountError);

    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'USDC', 'ReceiverPublicKey');
    } catch (error) {
      if (error instanceof PaymentNetworkError) {
        expect(error.originalError).toBe(accountError);
        expect(error.message).toContain('Payment failed on Solana network');
      }
    }
  });
});