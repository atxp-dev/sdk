import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BasePaymentMaker } from './basePaymentMaker.js';
import { InsufficientFundsError, PaymentNetworkError } from './types.js';
import { BigNumber } from 'bignumber.js';

// Mock viem functions
vi.mock('viem', () => ({
  createWalletClient: vi.fn(() => ({
    extend: vi.fn(() => ({
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
      signMessage: vi.fn(),
      sendTransaction: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
      readContract: vi.fn(),
    };

    paymentMaker = new BasePaymentMaker(
      'https://fake-rpc.com',
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );

    // Inject our mock signing client (using any here is acceptable for testing internal state)
    (paymentMaker as any).signingClient = mockSigningClient;
  });

  it('should throw InsufficientFundsError when balance is less than required', async () => {
    // Mock balance check to return insufficient balance (5 USDC when 10 is required)
    const balanceInWei = BigInt(5 * 1_000_000); // 5 USDC with 6 decimals
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);

    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'USDC', '0xreceiver')
    ).rejects.toThrow(InsufficientFundsError);

    // Verify the error details
    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'USDC', '0xreceiver');
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
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      abi: expect.any(Array),
      functionName: 'balanceOf',
      args: ['0x1234567890abcdef1234567890abcdef12345678'],
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

    const result = await paymentMaker.makePayment(
      new BigNumber('10'), 
      'USDC', 
      '0xreceiver'
    );

    expect(result).toBe('0xtransactionhash');
    expect(mockSigningClient.readContract).toHaveBeenCalled();
    expect(mockSigningClient.sendTransaction).toHaveBeenCalled();
    expect(mockSigningClient.waitForTransactionReceipt).toHaveBeenCalled();
  });

  it('should throw PaymentNetworkError for unsupported currency', async () => {
    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'ETH', '0xreceiver')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'ETH', '0xreceiver');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNetworkError);
      
      if (error instanceof PaymentNetworkError) {
        expect(error.message).toContain('Only USDC currency is supported');
      }
    }

    // Verify balance check was not attempted
    expect(mockSigningClient.readContract).not.toHaveBeenCalled();
  });

  it('should throw PaymentNetworkError when transaction reverts', async () => {
    // Mock sufficient balance
    const balanceInWei = BigInt(15 * 1_000_000);
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);
    
    // Mock successful transaction but reverted receipt
    mockSigningClient.sendTransaction.mockResolvedValue('0xtransactionhash');
    mockSigningClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: BigInt(12345),
    });

    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'USDC', '0xreceiver')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'USDC', '0xreceiver');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNetworkError);
      
      if (error instanceof PaymentNetworkError) {
        expect(error.message).toContain('Transaction reverted');
        expect(error.originalError?.message).toContain('Transaction reverted on chain');
      }
    }
  });

  it('should wrap unexpected errors in PaymentNetworkError', async () => {
    // Mock balance check to throw unexpected error
    const unexpectedError = new Error('RPC connection failed');
    mockSigningClient.readContract.mockRejectedValue(unexpectedError);

    await expect(
      paymentMaker.makePayment(new BigNumber('10'), 'USDC', '0xreceiver')
    ).rejects.toThrow(PaymentNetworkError);

    try {
      await paymentMaker.makePayment(new BigNumber('10'), 'USDC', '0xreceiver');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNetworkError);
      
      if (error instanceof PaymentNetworkError) {
        expect(error.message).toContain('Payment failed on Base network');
        expect(error.message).toContain('RPC connection failed');
        expect(error.originalError).toBe(unexpectedError);
      }
    }
  });

  it('should handle edge case with zero balance', async () => {
    // Mock zero balance
    const balanceInWei = BigInt(0);
    mockSigningClient.readContract.mockResolvedValue(balanceInWei);

    await expect(
      paymentMaker.makePayment(new BigNumber('0.000001'), 'USDC', '0xreceiver')
    ).rejects.toThrow(InsufficientFundsError);

    try {
      await paymentMaker.makePayment(new BigNumber('0.000001'), 'USDC', '0xreceiver');
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

    const result = await paymentMaker.makePayment(
      new BigNumber('10'),
      'USDC',
      '0xreceiver'
    );

    expect(result).toBe('0xtransactionhash');
    expect(mockSigningClient.sendTransaction).toHaveBeenCalled();
  });
});