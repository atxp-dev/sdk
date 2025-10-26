import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { wrapWithX402 } from './x402Wrapper.js';
import { ATXPAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';

vi.mock('x402/client', () => ({
  createPaymentHeader: vi.fn().mockResolvedValue('mocked-payment-header'),
  selectPaymentRequirements: vi.fn((accepts, network) => {
    // Return the first accept that matches the network, or null
    return accepts.find((a: any) => a.network === network) || null;
  })
}));

describe('wrapWithX402', () => {
  let mockAccount: ATXPAccount;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockLogger: ConsoleLogger;
  let mockApprovePayment: ReturnType<typeof vi.fn>;
  let mockOnPayment: ReturnType<typeof vi.fn>;
  let mockOnPaymentFailure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create a mock ATXPAccount instance using the proper connection string format
    mockAccount = new ATXPAccount('https://test.com?connection_token=test-token&account_id=atxp:test-account');

    // Override the fetchFn to mock the ensure-currency call
    mockAccount.fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        message: 'Currency ensured',
        balance: { usdc: '100', iou: '0' }
      }), { status: 200 })
    );

    // Override the getSigner method
    mockAccount.getSigner = vi.fn().mockResolvedValue({
      address: '0x1234567890123456789012345678901234567890',
      signTypedData: vi.fn().mockResolvedValue('0xmockedsignature'),
      account: {
        address: '0x1234567890123456789012345678901234567890',
      },
      chain: {
        id: 8453,
      },
      transport: {},
    });

    // Mock fetch
    mockFetch = vi.fn();

    // Mock logger
    mockLogger = new ConsoleLogger({ prefix: '[Test]', level: LogLevel.DEBUG });

    // Mock callbacks
    mockApprovePayment = vi.fn().mockResolvedValue(true);
    mockOnPayment = vi.fn();
    mockOnPaymentFailure = vi.fn();
  });

  it('should throw an error if account is not an ATXPAccount', () => {
    // Create a non-ATXPAccount object
    const nonATXPAccount = {
      accountId: '0x1234567890123456789012345678901234567890',
      network: 'base',
      getSigner: vi.fn(),
    };

    expect(() => {
      wrapWithX402({
        mcpServer: 'https://example.com/mcp',
        account: nonATXPAccount as any,
        fetchFn: mockFetch,
        logger: mockLogger,
      });
    }).toThrow('Only ATXPAccount is supported for X402 payments');
  });

  it('should pass through normal requests without modification', async () => {
    const mockResponse = new Response('Success', { status: 200 });
    mockFetch.mockResolvedValue(mockResponse);

    const wrappedFetch = wrapWithX402({
      mcpServer: 'https://example.com/mcp',
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
    // First response: 402 with X402 challenge in JSON body
    const x402Challenge = {
      x402Version: 1,
      accepts: [
        {
          network: 'base',
          scheme: 'exact',
          payTo: '0xrecipient',
          maxAmountRequired: '1000000',
          description: 'Test payment',
        },
      ],
    };

    const first402Response = new Response(JSON.stringify(x402Challenge), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Second response: Success after payment
    const successResponse = new Response('Success', {
      status: 200,
      headers: {
        'X-PAYMENT-RESPONSE': JSON.stringify({ receipt: 'test-receipt' }),
      },
    });

    mockFetch
      .mockResolvedValueOnce(first402Response)
      .mockResolvedValueOnce(successResponse);

    const wrappedFetch = wrapWithX402({
      mcpServer: 'https://example.com/mcp',
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
        amount: expect.objectContaining({ toNumber: expect.any(Function) }),
        currency: 'USDC',
        iss: '0xrecipient',
      })
    );

    // Should have called onPayment callback
    expect(mockOnPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: expect.objectContaining({
          amount: expect.objectContaining({ toNumber: expect.any(Function) }),
          currency: 'USDC',
        }),
      })
    );

    // Should have made two fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should include X-PAYMENT header
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/api', {
      method: 'POST',
      body: 'test-body',
      headers: expect.any(Headers),
    });
  });

  it('should handle payment approval rejection', async () => {
    const x402Challenge = {
      x402Version: 1,
      accepts: [
        {
          network: 'base',
          scheme: 'exact',
          payTo: '0xrecipient',
          maxAmountRequired: '1000000',
          description: 'Test payment',
        },
      ],
    };

    const response402 = new Response(JSON.stringify(x402Challenge), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    mockFetch.mockResolvedValue(response402);
    mockApprovePayment.mockResolvedValue(false);

    const wrappedFetch = wrapWithX402({
      mcpServer: 'https://example.com/mcp',
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
          message: expect.stringContaining('Payment not approved'),
        }),
      })
    );

    // Should only have made one fetch call
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle missing X402 JSON body on 402 response', async () => {
    const response402 = new Response('Payment Required', {
      status: 402,
      // No JSON body with x402Version
    });

    mockFetch.mockResolvedValue(response402);

    const wrappedFetch = wrapWithX402({
      mcpServer: 'https://example.com/mcp',
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
      x402Version: 1,
      accepts: [
        {
          network: 'base',
          scheme: 'exact',
          payTo: '0xrecipient',
          maxAmountRequired: '1000000',
          description: 'Test payment',
        },
      ],
    };

    const response402 = new Response(JSON.stringify(x402Challenge), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    mockFetch.mockResolvedValue(response402);

    // Make getSigner throw an error
    mockAccount.getSigner = vi.fn().mockRejectedValue(new Error('Signer error'));

    const wrappedFetch = wrapWithX402({
      mcpServer: 'https://example.com/mcp',
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

  it('should handle no suitable payment option', async () => {
    // Mock selectPaymentRequirements to return null for unsupported network
    const { selectPaymentRequirements } = await import('x402/client');
    (selectPaymentRequirements as Mock).mockReturnValueOnce(null);

    // X402 challenge with unsupported network
    const x402Challenge = {
      x402Version: 1,
      accepts: [
        {
          network: 'ethereum',  // Not base
          scheme: 'exact',
          payTo: '0xrecipient',
          maxAmountRequired: '1000000',
          description: 'Test payment',
        },
      ],
    };

    const response402 = new Response(JSON.stringify(x402Challenge), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    mockFetch.mockResolvedValue(response402);

    const wrappedFetch = wrapWithX402({
      mcpServer: 'https://example.com/mcp',
      account: mockAccount,
      fetchFn: mockFetch,
      logger: mockLogger,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await wrappedFetch('https://example.com/api');

    // Should return the original 402 response
    expect(result.status).toBe(402);

    // Should not have tried to get signer since no suitable payment option
    expect(mockAccount.getSigner).not.toHaveBeenCalled();

    // Should not have called onPaymentFailure (just returns original 402)
    expect(mockOnPaymentFailure).not.toHaveBeenCalled();
  });
});