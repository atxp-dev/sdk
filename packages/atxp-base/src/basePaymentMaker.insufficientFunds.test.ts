import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BasePaymentMaker } from './basePaymentMaker.js';
import { InsufficientFundsError, PaymentNetworkError, UnsupportedCurrencyError, TransactionRevertedError } from '@atxp/client';
import { BigNumber } from 'bignumber.js';
import { USDC_CONTRACT_ADDRESS_BASE } from './baseConstants.js';

// Mock viem functions
vi.mock('viem', () => ({
  createWalletClient: vi.fn(() => ({
    account: {
      address: '0xtest-address',
    },
    extend: vi.fn(() => ({
      account: {
        address: '0xtest-address',
      },
      signMessage: vi.fn(),
      sendTransaction: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
      readContract: vi.fn(),
    })),
  })),
  http: vi.fn(),
  parseEther: vi.fn(() => BigInt(0)),
  publicActions: vi.fn(() => ({})),
  encodeFunctionData: vi.fn(() => '0xabcdef'),
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
  })),
}));

vi.mock('viem/chains', () => ({
  base: {},
}));

interface MockSigningClient {
  account: {
    address: string;
  };
  signMessage: ReturnType<typeof vi.fn>;
  sendTransaction: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
}

describe('BasePaymentMaker insufficient funds handling', () => {
  let paymentMaker: BasePaymentMaker;
  let mockSigningClient: MockSigningClient;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create a mock signing client
    mockSigningClient = {
      account: {
        address: '0xtest-address',
      },
      signMessage: vi.fn(),
      sendTransaction: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
      readContract: vi.fn(),
    };

    const walletClient = {
      account: {
        address: '0xtest-address',
      },
      extend: vi.fn(() => mockSigningClient),
    } as any;

    paymentMaker = new BasePaymentMaker(
      'https://fake-rpc.com',
      walletClient,
    );

    // Mock signing client is already injected via the walletClient.extend() mock
  });

  it('should throw InsufficientFundsError when balance is less than required', async () => {
    // Mock balance check to return insufficient balance (5 USDC when 10 is required)
    const balanceInWei = BigInt(5 * 1_000_000); // 5 USDC with 6 decimals
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);

    const destinations = [{
      chain: 'base' as const,
      currency: 'USDC' as const,
      address: '0xreceiver',
      amount: new BigNumber('10')
    }];

    await expect(
      paymentMaker.makePayment(destinations, '')
    ).rejects.toThrow(InsufficientFundsError);

    // Verify the error details
    try {
      await paymentMaker.makePayment(destinations, '');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);

      if (error instanceof InsufficientFundsError) {
        expect(error.currency).toBe('USDC');
        expect(error.required.toString()).toBe('10');
        expect(error.available?.toString()).toBe('5');
        expect(error.network).toBe('base');
        expect(error.message).toContain('insufficient USDC funds on base');
        expect(error.message).toContain('Required: 10, Available: 5');
      }
    }

    // Verify balance was checked
    expect(mockSigningClient.readContract).toHaveBeenCalledWith({
      address: USDC_CONTRACT_ADDRESS_BASE,
      abi: expect.any(Array),
      functionName: 'balanceOf',
      args: ['0xtest-address'],
    });

    // Verify transaction was not attempted
    expect(mockSigningClient.sendTransaction).not.toHaveBeenCalled();
  });

  it('should proceed with payment when balance is sufficient', async () => {
    // Mock balance check to return sufficient balance (15 USDC when 10 is required)
    const balanceInWei = BigInt(15 * 1_000_000); // 15 USDC with 6 decimals
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);

    // Mock successful transaction
    mockSigningClient.sendTransaction.mockResolvedValue('0xtransactionhash');
    mockSigningClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: BigInt(12345),
    });

    const destinations = [{
      chain: 'base' as const,
      currency: 'USDC' as const,
      address: '0xreceiver',
      amount: new BigNumber('10')
    }];

    const result = await paymentMaker.makePayment(destinations, '');

    expect(result).not.toBeNull();
    expect(result!.transactionId).toBe('0xtransactionhash');
    expect(result!.chain).toBe('base');
    expect(mockSigningClient.readContract).toHaveBeenCalled();
    expect(mockSigningClient.sendTransaction).toHaveBeenCalled();
    expect(mockSigningClient.waitForTransactionReceipt).toHaveBeenCalled();
  });

  it('should throw UnsupportedCurrencyError for unsupported currency', async () => {
    const destinations = [{
      chain: 'base' as const,
      currency: 'ETH' as any,
      address: '0xreceiver',
      amount: new BigNumber('10')
    }];

    await expect(
      paymentMaker.makePayment(destinations, '')
    ).rejects.toThrow(UnsupportedCurrencyError);

    try {
      await paymentMaker.makePayment(destinations, '');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCurrencyError);

      if (error instanceof UnsupportedCurrencyError) {
        expect(error.currency).toBe('ETH');
        expect(error.network).toBe('base');
      }
    }

    // Verify balance check was not attempted
    expect(mockSigningClient.readContract).not.toHaveBeenCalled();
  });

  it('should throw TransactionRevertedError when transaction reverts', async () => {
    // Mock sufficient balance
    const balanceInWei = BigInt(15 * 1_000_000);
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);

    // Mock successful transaction but reverted receipt
    mockSigningClient.sendTransaction.mockResolvedValue('0xtransactionhash');
    mockSigningClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: BigInt(12345),
    });

    const destinations = [{
      chain: 'base' as const,
      currency: 'USDC' as const,
      address: '0xreceiver',
      amount: new BigNumber('10')
    }];

    await expect(
      paymentMaker.makePayment(destinations, '')
    ).rejects.toThrow(TransactionRevertedError);

    try {
      await paymentMaker.makePayment(destinations, '');
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionRevertedError);

      if (error instanceof TransactionRevertedError) {
        expect(error.transactionHash).toBe('0xtransactionhash');
        expect(error.network).toBe('base');
      }
    }
  });

  it('should wrap unexpected errors in PaymentNetworkError', async () => {
    // Mock balance check to throw unexpected error
    const unexpectedError = new Error('RPC connection failed');
    mockSigningClient.readContract.mockRejectedValue(unexpectedError);

    const destinations = [{
      chain: 'base' as const,
      currency: 'USDC' as const,
      address: '0xreceiver',
      amount: new BigNumber('10')
    }];

    await expect(
      paymentMaker.makePayment(destinations, '')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(destinations, '');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNetworkError);

      if (error instanceof PaymentNetworkError) {
        expect(error.message).toContain('Payment failed on base network');
        expect(error.message).toContain('RPC connection failed');
        expect(error.originalError).toBe(unexpectedError);
      }
    }
  });

  it('should handle edge case with zero balance', async () => {
    // Mock zero balance
    const balanceInWei = BigInt(0);
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);

    const destinations = [{
      chain: 'base' as const,
      currency: 'USDC' as const,
      address: '0xreceiver',
      amount: new BigNumber('0.000001')
    }];

    await expect(
      paymentMaker.makePayment(destinations, '')
    ).rejects.toThrow(InsufficientFundsError);

    try {
      await paymentMaker.makePayment(destinations, '');
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        expect(error.available?.toString()).toBe('0');
        expect(error.required.toString()).toBe('0.000001');
      }
    }
  });

  it('should handle exact balance match', async () => {
    // Mock exact balance (10 USDC when 10 is required)
    const balanceInWei = BigInt(10 * 1_000_000);
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);

    // Mock successful transaction
    mockSigningClient.sendTransaction.mockResolvedValue('0xtransactionhash');
    mockSigningClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: BigInt(12345),
    });

    const destinations = [{
      chain: 'base' as const,
      currency: 'USDC' as const,
      address: '0xreceiver',
      amount: new BigNumber('10')
    }];

    const result = await paymentMaker.makePayment(destinations, '');

    expect(result).not.toBeNull();
    expect(result!.transactionId).toBe('0xtransactionhash');
    expect(mockSigningClient.sendTransaction).toHaveBeenCalled();
  });

  it('should return null when no base destinations provided', async () => {
    const destinations = [{
      chain: 'solana' as const,
      currency: 'USDC' as const,
      address: 'SolanaAddress123',
      amount: new BigNumber('10')
    }];

    const result = await paymentMaker.makePayment(destinations, '');

    // Should return null since this payment maker only handles base
    expect(result).toBeNull();

    // Should not check balance or attempt transaction
    expect(mockSigningClient.readContract).not.toHaveBeenCalled();
    expect(mockSigningClient.sendTransaction).not.toHaveBeenCalled();
  });
});
