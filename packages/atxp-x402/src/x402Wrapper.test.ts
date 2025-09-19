import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wrapWithX402 } from './x402Wrapper.js';
import { BaseAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';

describe('wrapWithX402', () => {
  let mockAccount: BaseAccount;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockLogger: ConsoleLogger;
  let mockApprovePayment: ReturnType<typeof vi.fn>;
  let mockOnPayment: ReturnType<typeof vi.fn>;
  let mockOnPaymentFailure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock BaseAccount
    mockAccount = {
      accountId: '0x1234567890123456789012345678901234567890',
      network: 'base',
      getSigner: vi.fn().mockResolvedValue({
        address: '0x1234567890123456789012345678901234567890',
        signTypedData: vi.fn().mockResolvedValue('0xmockedsignature'),
      }),
    } as unknown as BaseAccount;

    // Mock fetch
    mockFetch = vi.fn();

    // Mock logger
    mockLogger = new ConsoleLogger({ prefix: '[Test]', level: LogLevel.DEBUG });

    // Mock callbacks
    mockApprovePayment = vi.fn().mockResolvedValue(true);
    mockOnPayment = vi.fn();
    mockOnPaymentFailure = vi.fn();
  });

  it('should pass through normal requests without modification', async () => {
    const mockResponse = new Response('Success', { status: 200 });
    mockFetch.mockResolvedValue(mockResponse);

    const wrappedFetch = wrapWithX402({
      account: mockAccount,
      fetchFn: mockFetch,
      logger: mockLogger,
    });

    const result = await wrappedFetch('https://example.com/api');

    expect(result).toBe(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/api', undefined);
    expect(mockAccount.getSigner).not.toHaveBeenCalled();
  });

  it('should handle 402 responses and retry with payment', async () => {
    // First response: 402 with X402 challenge
    const x402Challenge = {
      version: 0,
      created_at: Date.now(),
      expires_at: Date.now() + 60000,
      request_nonce: 'test-nonce',
      chain_id: 8453,
      currency: 'USDC',
      amount: '1000000',
      recipient: '0xrecipient',
      memo: 'Test payment',
      receipt_url: 'https://example.com/receipt',
      accepts: [
        {
          type: 'transferWithAuthorization',
          required: ['signature', 'authorization'],
        },
      ],
    };

    const first402Response = new Response('Payment Required', {
      status: 402,
      headers: {
        'X-402': btoa(JSON.stringify(x402Challenge)),
      },
    });

    // Second response: Success after payment
    const successResponse = new Response('Success', {
      status: 200,
      headers: {
        'X-Payment-Response': btoa(JSON.stringify({ receipt: 'test-receipt' })),
      },
    });

    mockFetch
      .mockResolvedValueOnce(first402Response)
      .mockResolvedValueOnce(successResponse);

    const wrappedFetch = wrapWithX402({
      account: mockAccount,
      fetchFn: mockFetch,
      logger: mockLogger,
      approvePayment: mockApprovePayment,
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await wrappedFetch('https://example.com/api', {
      method: 'POST',
      body: 'test-body',
    });

    // Should have gotten the success response
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('Success');

    // Should have called getSigner
    expect(mockAccount.getSigner).toHaveBeenCalled();

    // Should have called approve payment
    expect(mockApprovePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '1000000',
        currency: 'USDC',
        recipient: '0xrecipient',
      })
    );

    // Should have called onPayment callback
    expect(mockOnPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: expect.objectContaining({
          amount: '1000000',
          currency: 'USDC',
        }),
      })
    );

    // Should have made two fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should include X-Payment header
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/api', {
      method: 'POST',
      body: 'test-body',
      headers: expect.objectContaining({
        'X-Payment': expect.any(String),
      }),
    });
  });

  it('should handle payment approval rejection', async () => {
    const x402Challenge = {
      version: 0,
      created_at: Date.now(),
      expires_at: Date.now() + 60000,
      request_nonce: 'test-nonce',
      chain_id: 8453,
      currency: 'USDC',
      amount: '1000000',
      recipient: '0xrecipient',
      accepts: [
        {
          type: 'transferWithAuthorization',
          required: ['signature', 'authorization'],
        },
      ],
    };

    const response402 = new Response('Payment Required', {
      status: 402,
      headers: {
        'X-402': btoa(JSON.stringify(x402Challenge)),
      },
    });

    mockFetch.mockResolvedValue(response402);
    mockApprovePayment.mockResolvedValue(false);

    const wrappedFetch = wrapWithX402({
      account: mockAccount,
      fetchFn: mockFetch,
      logger: mockLogger,
      approvePayment: mockApprovePayment,
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await wrappedFetch('https://example.com/api');

    // Should return the original 402 response
    expect(result.status).toBe(402);

    // Should have called approve payment
    expect(mockApprovePayment).toHaveBeenCalled();

    // Should NOT have called onPayment
    expect(mockOnPayment).not.toHaveBeenCalled();

    // Should have called onPaymentFailure
    expect(mockOnPaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('User rejected payment'),
        }),
      })
    );

    // Should only have made one fetch call
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle missing X-402 header on 402 response', async () => {
    const response402 = new Response('Payment Required', {
      status: 402,
      // No X-402 header
    });

    mockFetch.mockResolvedValue(response402);

    const wrappedFetch = wrapWithX402({
      account: mockAccount,
      fetchFn: mockFetch,
      logger: mockLogger,
    });

    const result = await wrappedFetch('https://example.com/api');

    // Should return the original 402 response
    expect(result.status).toBe(402);

    // Should not have tried to get signer
    expect(mockAccount.getSigner).not.toHaveBeenCalled();

    // Should only have made one fetch call
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle x402 library errors', async () => {
    const x402Challenge = {
      version: 0,
      created_at: Date.now(),
      expires_at: Date.now() + 60000,
      request_nonce: 'test-nonce',
      chain_id: 8453,
      currency: 'USDC',
      amount: '1000000',
      recipient: '0xrecipient',
      accepts: [
        {
          type: 'transferWithAuthorization',
          required: ['signature', 'authorization'],
        },
      ],
    };

    const response402 = new Response('Payment Required', {
      status: 402,
      headers: {
        'X-402': btoa(JSON.stringify(x402Challenge)),
      },
    });

    mockFetch.mockResolvedValue(response402);

    // Make getSigner throw an error
    mockAccount.getSigner = vi.fn().mockRejectedValue(new Error('Signer error'));

    const wrappedFetch = wrapWithX402({
      account: mockAccount,
      fetchFn: mockFetch,
      logger: mockLogger,
      approvePayment: mockApprovePayment,
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await wrappedFetch('https://example.com/api');

    // Should return the original 402 response
    expect(result.status).toBe(402);

    // Should have called onPaymentFailure
    expect(mockOnPaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('Signer error'),
        }),
      })
    );

    // Should only have made one fetch call
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle wrong network account', async () => {
    // Account on wrong network
    const wrongNetworkAccount = {
      accountId: '0x1234567890123456789012345678901234567890',
      network: 'solana', // Not base
      getSigner: vi.fn(),
    } as unknown as BaseAccount;

    const x402Challenge = {
      version: 0,
      created_at: Date.now(),
      expires_at: Date.now() + 60000,
      request_nonce: 'test-nonce',
      chain_id: 8453, // Base mainnet
      currency: 'USDC',
      amount: '1000000',
      recipient: '0xrecipient',
      accepts: [
        {
          type: 'transferWithAuthorization',
          required: ['signature', 'authorization'],
        },
      ],
    };

    const response402 = new Response('Payment Required', {
      status: 402,
      headers: {
        'X-402': btoa(JSON.stringify(x402Challenge)),
      },
    });

    mockFetch.mockResolvedValue(response402);

    const wrappedFetch = wrapWithX402({
      account: wrongNetworkAccount,
      fetchFn: mockFetch,
      logger: mockLogger,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await wrappedFetch('https://example.com/api');

    // Should return the original 402 response
    expect(result.status).toBe(402);

    // Should not have tried to get signer
    expect(wrongNetworkAccount.getSigner).not.toHaveBeenCalled();

    // Should have called onPaymentFailure with network mismatch error
    expect(mockOnPaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('network'),
        }),
      })
    );
  });
});