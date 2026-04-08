import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryOAuthDb, Account, ConsoleLogger, LogLevel, PAYMENT_REQUIRED_ERROR_CODE } from '@atxp/common';
import { ATXPFetcher } from './atxpFetcher.js';
import { X402ProtocolHandler } from './x402ProtocolHandler.js';
import { ATXPProtocolHandler } from './atxpProtocolHandler.js';
import { MPPProtocolHandler } from './mppProtocolHandler.js';
import { MPP_ERROR_CODE } from '@atxp/mpp';
import type { ProtocolHandler, ProtocolConfig } from './protocolHandler.js';
import type { PaymentMaker } from './types.js';
import { PassthroughDestinationMaker } from './destinationMakers/passthroughDestinationMaker.js';
const DEFAULT_AUTHORIZATION_SERVER = 'https://auth.atxp.ai';

// Mock x402/client for X402ProtocolHandler tests
vi.mock('x402/client', () => ({
  createPaymentHeader: vi.fn().mockResolvedValue('mocked-x402-payment-header'),
  selectPaymentRequirements: vi.fn((accepts: any[], network?: string) => {
    if (!network) return accepts[0] || null;
    return accepts.find((a: any) => a.network === network) || null;
  })
}));

function createMockAccount(paymentMakers?: PaymentMaker[]): Account {
  return {
    getAccountId: async () => 'base:0xtest' as any,
    paymentMakers: paymentMakers ?? [{
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    }],
    usesAccountsAuthorize: false,
    getSources: async () => [{ address: 'SolAddress123', chain: 'solana' as any, walletType: 'eoa' as any }],
    createSpendPermission: async () => null,
    authorize: vi.fn().mockResolvedValue({ protocol: 'atxp', credential: '{}' }),
  };
}

function createX402Challenge() {
  return {
    x402Version: 2,
    accepts: [{
      network: 'eip155:8453',
      scheme: 'exact',
      payTo: '0xrecipient',
      amount: '1000000',
      description: 'Test payment',
    }]
  };
}

function createMcpPaymentRequiredResponse() {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: PAYMENT_REQUIRED_ERROR_CODE,
      message: 'Payment Required',
      data: {
        paymentRequestUrl: `${DEFAULT_AUTHORIZATION_SERVER}/payment-request/test-id`,
        paymentRequestId: 'test-id'
      }
    }
  });
}

function createMPPWWWAuthenticateHeader(): string {
  return 'Payment method="tempo", intent="charge", id="ch_xxx", amount="1000000", currency="pathUSD", network="tempo", recipient="0xrecipient"';
}

function createMPPMCPErrorBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: MPP_ERROR_CODE,
      message: 'Payment Required',
      data: {
        mpp: {
          id: 'ch_xxx',
          method: 'tempo',
          intent: 'charge',
          amount: '1000000',
          currency: 'pathUSD',
          network: 'tempo',
          recipient: '0xrecipient',
        },
      },
    },
  };
}

describe('X402ProtocolHandler', () => {
  let handler: X402ProtocolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new X402ProtocolHandler();
  });

  describe('canHandle', () => {
    it('should detect X402 challenge in 402 response', async () => {
      const response = new Response(JSON.stringify(createX402Challenge()), { status: 402 });
      expect(await handler.canHandle(response)).toBe(true);
    });

    it('should not match non-402 responses', async () => {
      const response = new Response('OK', { status: 200 });
      expect(await handler.canHandle(response)).toBe(false);
    });

    it('should not match 402 without x402Version', async () => {
      const response = new Response(JSON.stringify({ error: 'Payment Required' }), { status: 402 });
      expect(await handler.canHandle(response)).toBe(false);
    });

    it('should not match 402 with non-JSON body', async () => {
      const response = new Response('Payment Required', { status: 402 });
      expect(await handler.canHandle(response)).toBe(false);
    });
  });

  describe('handlePaymentChallenge', () => {
    it('should call account.authorize for x402 and retry with X-PAYMENT header', async () => {
      const mockFetch = vi.fn();
      // Retry response (account.authorize handles /authorize/x402 now)
      mockFetch.mockResolvedValueOnce(new Response('Success', { status: 200 }));

      const mockAccount = createMockAccount();
      (mockAccount.authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
        protocol: 'x402',
        credential: 'test-payment-header',
      });

      const mockOnPayment = vi.fn();
      const config: ProtocolConfig = {
        account: mockAccount,
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: mockFetch,
        approvePayment: async () => true,
        onPayment: mockOnPayment,
        onPaymentFailure: async () => {},
      };

      const response = new Response(JSON.stringify(createX402Challenge()), { status: 402 });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe(200);

      // Verify account.authorize was called with x402 protocol
      expect(mockAccount.authorize).toHaveBeenCalledWith(
        expect.objectContaining({ protocols: ['x402'] })
      );

      // Verify retry included X-PAYMENT header
      const retryCall = mockFetch.mock.calls[0];
      const retryHeaders = retryCall[1].headers as Headers;
      expect(retryHeaders.get('X-PAYMENT')).toBe('test-payment-header');

      // Verify onPayment was called
      expect(mockOnPayment).toHaveBeenCalled();
    });

    it('should reject payment when approvePayment returns false', async () => {
      const mockOnPaymentFailure = vi.fn();
      const config: ProtocolConfig = {
        account: createMockAccount(),
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: vi.fn(),
        approvePayment: async () => false,
        onPayment: async () => {},
        onPaymentFailure: mockOnPaymentFailure,
      };

      const response = new Response(JSON.stringify(createX402Challenge()), { status: 402 });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe(402);
      expect(mockOnPaymentFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: 'Payment not approved' })
        })
      );
    });

    it('should handle invalid /authorize/x402 response (missing paymentHeader)', async () => {
      const mockFetch = vi.fn();

      const mockAccount = createMockAccount();
      // account.authorize throws when the server response is missing paymentHeader
      (mockAccount.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ATXPAccount: /authorize/x402 response missing or invalid paymentHeader')
      );

      const mockOnPaymentFailure = vi.fn();
      const config: ProtocolConfig = {
        account: mockAccount,
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: mockFetch,
        approvePayment: async () => true,
        onPayment: async () => {},
        onPaymentFailure: mockOnPaymentFailure,
      };

      const response = new Response(JSON.stringify(createX402Challenge()), { status: 402 });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      // Should fall back to reconstructed response
      expect(result).not.toBeNull();
      expect(result!.status).toBe(402);
      expect(mockOnPaymentFailure).toHaveBeenCalled();
    });
  });
});

describe('ATXPProtocolHandler', () => {
  let handler: ATXPProtocolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new ATXPProtocolHandler();
  });

  describe('canHandle', () => {
    it('should detect ATXP-MCP payment challenge (error code -30402)', async () => {
      const response = new Response(createMcpPaymentRequiredResponse(), { status: 200 });
      expect(await handler.canHandle(response)).toBe(true);
    });

    it('should not match response without payment required error', async () => {
      const response = new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
      expect(await handler.canHandle(response)).toBe(false);
    });

    it('should not match empty response', async () => {
      const response = new Response('', { status: 200 });
      expect(await handler.canHandle(response)).toBe(false);
    });

    it('should return false for canHandle throwing', async () => {
      // Response that will cause JSON.parse to fail in extractPaymentRequests
      const response = new Response('not valid json or sse', { status: 200 });
      expect(await handler.canHandle(response)).toBe(false);
    });
  });

  describe('handlePaymentChallenge', () => {
    it('should return null instead of throwing (strategy pattern contract)', async () => {
      const config: ProtocolConfig = {
        account: createMockAccount(),
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: vi.fn(),
        approvePayment: async () => true,
        onPayment: async () => {},
        onPaymentFailure: async () => {},
      };

      const response = new Response(createMcpPaymentRequiredResponse(), { status: 200 });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      // Should return null, not throw - the fetcher's checkForATXPResponse handles the MCP flow
      expect(result).toBeNull();
    });

    it('should return null for empty payment requests', async () => {
      const config: ProtocolConfig = {
        account: createMockAccount(),
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: vi.fn(),
        approvePayment: async () => true,
        onPayment: async () => {},
        onPaymentFailure: async () => {},
      };

      const response = new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      expect(result).toBeNull();
    });
  });
});

describe('ATXPFetcher with protocol handlers', () => {
  let mockOnPayment: ReturnType<typeof vi.fn>;
  let mockOnPaymentFailure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnPayment = vi.fn();
    mockOnPaymentFailure = vi.fn();
  });

  function createFetcher(
    fetchFn: any,
    protocolHandlers: ProtocolHandler[],
    protocolFlag?: (userId: string, destination: string) => any
  ) {
    const account = createMockAccount();
    const destinationMakers = new Map();
    destinationMakers.set('solana', new PassthroughDestinationMaker('solana'));

    return new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers,
      fetchFn,
      protocolHandlers,
      protocolFlag,
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });
  }

  it('should use X402 handler when protocolFlag returns x402 for omni-challenge', async () => {
    const x402Handler = new X402ProtocolHandler();
    const atxpHandler = new ATXPProtocolHandler();

    const mockFetch = vi.fn();

    // Initial request returns X402 challenge (simulates omni-challenge)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createX402Challenge()), { status: 402 })
    );
    // Retry response (account.authorize handles /authorize/x402 now)
    mockFetch.mockResolvedValueOnce(new Response('Success', { status: 200 }));

    const account = createMockAccount();
    (account.authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      protocol: 'x402',
      credential: 'x402-header',
    });

    const destinationMakers = new Map();
    destinationMakers.set('solana', new PassthroughDestinationMaker('solana'));
    const fetcher = new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers,
      fetchFn: mockFetch,
      protocolHandlers: [x402Handler, atxpHandler],
      protocolFlag: (_userId: string, _destination: string) => 'x402',
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await fetcher.fetch('https://example.com/api');
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('Success');

    // Verify account.authorize was called (X402 handler was used)
    expect(account.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ protocols: ['x402'] })
    );
  });

  it('should use ATXP handler when protocolFlag returns atxp', async () => {
    // Create a mock handler that records which protocol was selected
    const mockX402Handler: ProtocolHandler = {
      protocol: 'x402',
      canHandle: async (response: Response) => response.status === 402,
      handlePaymentChallenge: vi.fn().mockResolvedValue(new Response('X402 handled', { status: 200 })),
    };

    const mockAtxpHandler: ProtocolHandler = {
      protocol: 'atxp',
      canHandle: async (response: Response) => response.status === 402,
      handlePaymentChallenge: vi.fn().mockResolvedValue(new Response('ATXP handled', { status: 200 })),
    };

    const mockFetch = vi.fn();
    // Return a 402 that both handlers can handle
    mockFetch.mockResolvedValueOnce(new Response('challenge', { status: 402 }));

    const fetcher = createFetcher(
      mockFetch,
      [mockX402Handler, mockAtxpHandler],
      (_userId: string, _destination: string) => 'atxp'
    );

    const result = await fetcher.fetch('https://example.com/api');
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('ATXP handled');

    // Verify ATXP handler was called, not X402
    expect(mockAtxpHandler.handlePaymentChallenge).toHaveBeenCalled();
    expect(mockX402Handler.handlePaymentChallenge).not.toHaveBeenCalled();
  });

  it('should auto-detect protocol when only one handler matches', async () => {
    const x402Handler = new X402ProtocolHandler();

    const mockFetch = vi.fn();
    // Initial request returns X402 challenge
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createX402Challenge()), { status: 402 })
    );
    // Retry response (account.authorize handles /authorize/x402 now)
    mockFetch.mockResolvedValueOnce(new Response('Auto-detected', { status: 200 }));

    const account = createMockAccount();
    (account.authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      protocol: 'x402',
      credential: 'auto-detected-header',
    });

    const destinationMakers = new Map();
    destinationMakers.set('solana', new PassthroughDestinationMaker('solana'));
    // No protocolFlag — auto-detect
    const fetcher = new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers,
      fetchFn: mockFetch,
      protocolHandlers: [x402Handler],
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await fetcher.fetch('https://example.com/api');
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('Auto-detected');
  });

  it('should pass through non-challenge responses without calling handlers', async () => {
    const mockHandler: ProtocolHandler = {
      protocol: 'x402',
      canHandle: vi.fn().mockResolvedValue(false),
      handlePaymentChallenge: vi.fn(),
    };

    const mockFetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

    const fetcher = createFetcher(mockFetch, [mockHandler]);
    const result = await fetcher.fetch('https://example.com/api');

    expect(result.status).toBe(200);
    expect(mockHandler.handlePaymentChallenge).not.toHaveBeenCalled();
  });

  it('should preserve existing ATXP-MCP flow when no protocol handlers match', async () => {
    // When protocol handlers array is empty, a normal 200 response should pass through
    // and the existing ATXP-MCP error detection (checkForATXPResponse) should still work
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200 }));

    const fetcher = createFetcher(mockFetch, []);
    const result = await fetcher.fetch('https://example.com/api');

    expect(result).toBeDefined();
    expect(result.status).toBe(200);
  });
});

describe('MPPProtocolHandler', () => {
  let handler: MPPProtocolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new MPPProtocolHandler();
  });

  describe('canHandle', () => {
    it('should detect MPP challenge from WWW-Authenticate: Payment header', async () => {
      const response = new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': createMPPWWWAuthenticateHeader() },
      });
      expect(await handler.canHandle(response)).toBe(true);
    });

    it('should detect MPP MCP challenge (error code -32042)', async () => {
      const response = new Response(JSON.stringify(createMPPMCPErrorBody()), { status: 200 });
      expect(await handler.canHandle(response)).toBe(true);
    });

    it('should not match non-402 responses without MPP header', async () => {
      const response = new Response('OK', { status: 200 });
      expect(await handler.canHandle(response)).toBe(false);
    });

    it('should not match 402 without WWW-Authenticate header', async () => {
      const response = new Response('Payment Required', { status: 402 });
      expect(await handler.canHandle(response)).toBe(false);
    });

    it('should not match response with different error code', async () => {
      const body = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Other error', data: {} },
      };
      const response = new Response(JSON.stringify(body), { status: 200 });
      expect(await handler.canHandle(response)).toBe(false);
    });
  });

  describe('handlePaymentChallenge', () => {
    it('should call account.authorize for mpp and retry with Authorization: Payment header', async () => {
      const mockFetch = vi.fn();
      // Retry response (account.authorize handles the /authorize/mpp call now)
      mockFetch.mockResolvedValueOnce(new Response('Success', { status: 200 }));

      const mockAccount = createMockAccount();
      (mockAccount.authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
        protocol: 'mpp',
        credential: 'mpp-credential-base64',
      });

      const mockOnPayment = vi.fn();
      const config: ProtocolConfig = {
        account: mockAccount,
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: mockFetch,
        approvePayment: async () => true,
        onPayment: mockOnPayment,
        onPaymentFailure: async () => {},
      };

      const response = new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': createMPPWWWAuthenticateHeader() },
      });

      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe(200);

      // Verify account.authorize was called with mpp protocol
      expect(mockAccount.authorize).toHaveBeenCalledWith(
        expect.objectContaining({ protocols: ['mpp'] })
      );

      // Verify retry included X-MPP-Payment header
      const retryCall = mockFetch.mock.calls[0];
      const retryHeaders = retryCall[1].headers as Headers;
      expect(retryHeaders.get('X-MPP-Payment')).toBe('mpp-credential-base64');

      // Verify onPayment was called
      expect(mockOnPayment).toHaveBeenCalled();
    });

    it('should reject payment when approvePayment returns false', async () => {
      const mockOnPaymentFailure = vi.fn();
      const config: ProtocolConfig = {
        account: createMockAccount(),
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: vi.fn(),
        approvePayment: async () => false,
        onPayment: async () => {},
        onPaymentFailure: mockOnPaymentFailure,
      };

      const response = new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': createMPPWWWAuthenticateHeader() },
      });

      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe(402);
      expect(mockOnPaymentFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: 'Payment not approved' }),
        })
      );
    });

    it('should handle graceful fallback when account.authorize fails', async () => {
      const mockFetch = vi.fn();

      const mockAccount = createMockAccount();
      // account.authorize throws an error containing '/authorize/mpp failed'
      (mockAccount.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ATXPAccount: /authorize/mpp failed (404): Not Found')
      );

      const config: ProtocolConfig = {
        account: mockAccount,
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: mockFetch,
        approvePayment: async () => true,
        onPayment: async () => {},
        onPaymentFailure: async () => {},
      };

      const response = new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': createMPPWWWAuthenticateHeader() },
      });

      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      // Should return original response status (graceful fallback)
      expect(result).not.toBeNull();
      expect(result!.status).toBe(402);

      // Should NOT have called fetchFn for retry
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });

    it('should preserve original response headers and statusText in reconstructed response', async () => {
      const mockOnPaymentFailure = vi.fn();
      const config: ProtocolConfig = {
        account: createMockAccount(),
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: vi.fn(),
        approvePayment: async () => false,
        onPayment: async () => {},
        onPaymentFailure: mockOnPaymentFailure,
      };

      const response = new Response('payment body', {
        status: 402,
        statusText: 'Payment Required',
        headers: {
          'WWW-Authenticate': createMPPWWWAuthenticateHeader(),
          'X-Custom-Header': 'custom-value',
        },
      });

      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe(402);
      expect(result!.statusText).toBe('Payment Required');
      expect(result!.headers.get('X-Custom-Header')).toBe('custom-value');
    });

    it('should handle invalid /authorize/mpp response (missing credential)', async () => {
      const mockFetch = vi.fn();

      const mockAccount = createMockAccount();
      // account.authorize throws when the server response is missing credential
      (mockAccount.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ATXPAccount: /authorize/mpp response missing or invalid credential')
      );

      const mockOnPaymentFailure = vi.fn();
      const config: ProtocolConfig = {
        account: mockAccount,
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: mockFetch,
        approvePayment: async () => true,
        onPayment: async () => {},
        onPaymentFailure: mockOnPaymentFailure,
      };

      const response = new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': createMPPWWWAuthenticateHeader() },
      });

      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      // Should fall back to reconstructed response, not crash
      expect(result).not.toBeNull();
      expect(result!.status).toBe(402);
      expect(mockOnPaymentFailure).toHaveBeenCalled();
    });

    it('should handle malformed MPP headers gracefully', async () => {
      const response = new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': 'Bearer realm="test"' },
      });

      expect(await handler.canHandle(response)).toBe(false);
    });

    it('should preserve headers/statusText on authorize fallback', async () => {
      const mockFetch = vi.fn();

      const mockAccount = createMockAccount();
      // account.authorize throws to trigger fallback
      (mockAccount.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ATXPAccount: /authorize/mpp failed (404): Not Found')
      );

      const config: ProtocolConfig = {
        account: mockAccount,
        logger: new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR }),
        fetchFn: mockFetch,
        approvePayment: async () => true,
        onPayment: async () => {},
        onPaymentFailure: async () => {},
      };

      const response = new Response('', {
        status: 402,
        statusText: 'Payment Required',
        headers: {
          'WWW-Authenticate': createMPPWWWAuthenticateHeader(),
          'X-Request-Id': 'req-123',
        },
      });

      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config
      );

      expect(result).not.toBeNull();
      expect(result!.statusText).toBe('Payment Required');
      expect(result!.headers.get('X-Request-Id')).toBe('req-123');
    });
  });
});

describe('ATXPFetcher with MPP handler', () => {
  let mockOnPayment: ReturnType<typeof vi.fn>;
  let mockOnPaymentFailure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnPayment = vi.fn();
    mockOnPaymentFailure = vi.fn();
  });

  function createFetcherWithMPP(
    fetchFn: any,
    protocolHandlers: ProtocolHandler[],
    protocolFlag?: (userId: string, destination: string) => any
  ) {
    const account = createMockAccount();
    const destinationMakers = new Map();
    destinationMakers.set('solana', new PassthroughDestinationMaker('solana'));

    return new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers,
      fetchFn,
      protocolHandlers,
      protocolFlag,
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });
  }

  it('should use MPP handler when protocolFlag returns mpp for omni-challenge', async () => {
    const mppHandler = new MPPProtocolHandler();
    const x402Handler = new X402ProtocolHandler();

    const mockFetch = vi.fn();

    // Initial request returns 402 with both MPP header and X402 body (omni-challenge)
    const x402Body = JSON.stringify(createX402Challenge());
    mockFetch.mockResolvedValueOnce(
      new Response(x402Body, {
        status: 402,
        headers: { 'WWW-Authenticate': createMPPWWWAuthenticateHeader() },
      })
    );
    // Retry response (account.authorize handles /authorize/mpp now)
    mockFetch.mockResolvedValueOnce(new Response('MPP Success', { status: 200 }));

    const account = createMockAccount();
    (account.authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      protocol: 'mpp',
      credential: 'mpp-cred',
    });

    const destinationMakers = new Map();
    destinationMakers.set('solana', new PassthroughDestinationMaker('solana'));
    const fetcher = new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers,
      fetchFn: mockFetch,
      protocolHandlers: [x402Handler, mppHandler],
      protocolFlag: (_userId: string, _destination: string) => 'mpp',
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await fetcher.fetch('https://example.com/api');
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('MPP Success');

    // Verify account.authorize was called (MPP handler was used, not X402)
    expect(account.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ protocols: ['mpp'] })
    );
  });

  it('should still use ATXP handler when protocolFlag returns atxp (regression)', async () => {
    const mockMppHandler: ProtocolHandler = {
      protocol: 'mpp',
      canHandle: async (response: Response) => response.status === 402,
      handlePaymentChallenge: vi.fn().mockResolvedValue(new Response('MPP handled', { status: 200 })),
    };

    const mockAtxpHandler: ProtocolHandler = {
      protocol: 'atxp',
      canHandle: async (response: Response) => response.status === 402,
      handlePaymentChallenge: vi.fn().mockResolvedValue(new Response('ATXP handled', { status: 200 })),
    };

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response('challenge', { status: 402 }));

    const fetcher = createFetcherWithMPP(
      mockFetch,
      [mockMppHandler, mockAtxpHandler],
      (_userId: string, _destination: string) => 'atxp'
    );

    const result = await fetcher.fetch('https://example.com/api');
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('ATXP handled');

    expect(mockAtxpHandler.handlePaymentChallenge).toHaveBeenCalled();
    expect(mockMppHandler.handlePaymentChallenge).not.toHaveBeenCalled();
  });

  it('should still use X402 handler when protocolFlag returns x402 (regression)', async () => {
    const mockMppHandler: ProtocolHandler = {
      protocol: 'mpp',
      canHandle: async (response: Response) => response.status === 402,
      handlePaymentChallenge: vi.fn().mockResolvedValue(new Response('MPP handled', { status: 200 })),
    };

    const mockX402Handler: ProtocolHandler = {
      protocol: 'x402',
      canHandle: async (response: Response) => response.status === 402,
      handlePaymentChallenge: vi.fn().mockResolvedValue(new Response('X402 handled', { status: 200 })),
    };

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response('challenge', { status: 402 }));

    const fetcher = createFetcherWithMPP(
      mockFetch,
      [mockMppHandler, mockX402Handler],
      (_userId: string, _destination: string) => 'x402'
    );

    const result = await fetcher.fetch('https://example.com/api');
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('X402 handled');

    expect(mockX402Handler.handlePaymentChallenge).toHaveBeenCalled();
    expect(mockMppHandler.handlePaymentChallenge).not.toHaveBeenCalled();
  });

  it('should auto-detect MPP from external server (WWW-Authenticate header)', async () => {
    const mppHandler = new MPPProtocolHandler();

    const mockFetch = vi.fn();
    // External server returns 402 with MPP header
    mockFetch.mockResolvedValueOnce(
      new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': createMPPWWWAuthenticateHeader() },
      })
    );
    // Retry response (account.authorize handles /authorize/mpp now)
    mockFetch.mockResolvedValueOnce(new Response('Auto-detected MPP', { status: 200 }));

    const account = createMockAccount();
    (account.authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      protocol: 'mpp',
      credential: 'auto-cred',
    });

    const destinationMakers = new Map();
    destinationMakers.set('solana', new PassthroughDestinationMaker('solana'));
    // No protocolFlag — auto-detect
    const fetcher = new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers,
      fetchFn: mockFetch,
      protocolHandlers: [mppHandler],
      onPayment: mockOnPayment,
      onPaymentFailure: mockOnPaymentFailure,
    });

    const result = await fetcher.fetch('https://external.example.com/api');
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('Auto-detected MPP');

    // Verify account.authorize was called
    expect(account.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ protocols: ['mpp'] })
    );
  });
});
