import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import { PaymentClient, buildPaymentHeaders, type AuthorizeResult } from './paymentClient.js';
import { BigNumber } from 'bignumber.js';

function createMockAccount() {
  return {
    token: 'test-token-123',
    getAccountId: async () => 'base:0xtest' as any,
    paymentMakers: [],
    getSources: async () => [],
    createSpendPermission: async () => null,
  };
}

const logger = new ConsoleLogger({ prefix: '[Test]', level: LogLevel.ERROR });

describe('buildPaymentHeaders', () => {
  it('should set X-PAYMENT header for x402 protocol', () => {
    const result: AuthorizeResult = { protocol: 'x402', credential: 'x402-cred' };
    const headers = buildPaymentHeaders(result);

    expect(headers.get('X-PAYMENT')).toBe('x402-cred');
    expect(headers.get('Access-Control-Expose-Headers')).toBe('X-PAYMENT-RESPONSE');
  });

  it('should set Authorization: Payment header for mpp protocol', () => {
    const result: AuthorizeResult = { protocol: 'mpp', credential: 'mpp-cred' };
    const headers = buildPaymentHeaders(result);

    expect(headers.get('Authorization')).toBe('Payment mpp-cred');
  });

  it('should not add any special headers for atxp protocol', () => {
    const result: AuthorizeResult = { protocol: 'atxp', credential: '{"foo":"bar"}' };
    const headers = buildPaymentHeaders(result);

    expect(headers.get('X-PAYMENT')).toBeNull();
    expect(headers.get('Authorization')).toBeNull();
  });

  it('should preserve original headers when provided as Headers object', () => {
    const original = new Headers({ 'X-Custom': 'value', 'Accept': 'application/json' });
    const result: AuthorizeResult = { protocol: 'x402', credential: 'cred' };
    const headers = buildPaymentHeaders(result, original);

    expect(headers.get('X-Custom')).toBe('value');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-PAYMENT')).toBe('cred');
  });

  it('should preserve original headers when provided as plain object', () => {
    const result: AuthorizeResult = { protocol: 'mpp', credential: 'cred' };
    const headers = buildPaymentHeaders(result, { 'X-Custom': 'value' });

    expect(headers.get('X-Custom')).toBe('value');
    expect(headers.get('Authorization')).toBe('Payment cred');
  });

  it('should handle undefined original headers', () => {
    const result: AuthorizeResult = { protocol: 'x402', credential: 'cred' };
    const headers = buildPaymentHeaders(result, undefined);

    expect(headers.get('X-PAYMENT')).toBe('cred');
  });
});

describe('PaymentClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
  });

  describe('authorize', () => {
    it('should call /authorize/x402 with correct body and return paymentHeader as credential', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ paymentHeader: 'x402-payment-header' }), { status: 200 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account: createMockAccount(),
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        protocol: 'x402',
        paymentRequirements: { network: 'base', scheme: 'exact' },
      });

      expect(result.protocol).toBe('x402');
      expect(result.credential).toBe('x402-payment-header');

      // Verify the fetch call
      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.test.com/authorize/x402',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ paymentRequirements: { network: 'base', scheme: 'exact' } }),
        })
      );

      // Verify Basic auth header
      const callHeaders = mockFetch.mock.calls[0][1].headers;
      const expectedAuth = `Basic ${Buffer.from('test-token-123:').toString('base64')}`;
      expect(callHeaders['Authorization']).toBe(expectedAuth);
    });

    it('should call /authorize/mpp with correct body and return credential', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ credential: 'mpp-credential-value' }), { status: 200 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const challenge = { id: 'ch_1', method: 'tempo', amount: '1000000' };
      const result = await client.authorize({
        account: createMockAccount(),
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        protocol: 'mpp',
        challenge,
      });

      expect(result.protocol).toBe('mpp');
      expect(result.credential).toBe('mpp-credential-value');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.test.com/authorize/mpp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ challenge }),
        })
      );
    });

    it('should call /authorize/atxp with amount, currency, receiver, memo', async () => {
      const responseBody = { transactionId: 'tx_123', status: 'completed' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), { status: 200 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account: createMockAccount(),
        userId: 'base:0xtest',
        destination: '0xrecipient',
        protocol: 'atxp',
        amount: new BigNumber('1.5'),
        memo: 'test payment',
      });

      expect(result.protocol).toBe('atxp');
      expect(result.credential).toBe(JSON.stringify(responseBody));

      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.test.com/authorize/atxp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            amount: '1.5',
            currency: 'USDC',
            receiver: '0xrecipient',
            memo: 'test payment',
          }),
        })
      );
    });

    it('should use protocolFlag when no explicit protocol is provided', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ credential: 'flag-cred' }), { status: 200 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        protocolFlag: (_userId, _dest) => 'mpp',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account: createMockAccount(),
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        challenge: { id: 'ch_1' },
      });

      expect(result.protocol).toBe('mpp');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.test.com/authorize/mpp',
        expect.anything()
      );
    });

    it('should default to atxp when no protocol or protocolFlag', async () => {
      const responseBody = { status: 'ok' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), { status: 200 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account: createMockAccount(),
        userId: 'base:0xtest',
        destination: '0xrecipient',
        amount: new BigNumber('1'),
      });

      expect(result.protocol).toBe('atxp');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.test.com/authorize/atxp',
        expect.anything()
      );
    });

    it('should throw when server returns non-OK status', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      await expect(
        client.authorize({
          account: createMockAccount(),
          userId: 'base:0xtest',
          destination: 'https://example.com/api',
          protocol: 'x402',
          paymentRequirements: {},
        })
      ).rejects.toThrow('/authorize/x402 failed (404)');
    });

    it('should throw when x402 response missing paymentHeader', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: 'response' }), { status: 200 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      await expect(
        client.authorize({
          account: createMockAccount(),
          userId: 'base:0xtest',
          destination: 'https://example.com/api',
          protocol: 'x402',
          paymentRequirements: {},
        })
      ).rejects.toThrow('missing or invalid paymentHeader');
    });

    it('should throw when mpp response missing credential', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ somethingElse: 'value' }), { status: 200 })
      );

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      await expect(
        client.authorize({
          account: createMockAccount(),
          userId: 'base:0xtest',
          destination: 'https://example.com/api',
          protocol: 'mpp',
          challenge: {},
        })
      ).rejects.toThrow('missing or invalid credential');
    });

    it('should not set Authorization header when account has no token', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ paymentHeader: 'cred' }), { status: 200 })
      );

      const accountNoToken = {
        getAccountId: async () => 'base:0xtest' as any,
        paymentMakers: [],
        getSources: async () => [],
        createSpendPermission: async () => null,
      };

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      await client.authorize({
        account: accountNoToken,
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        protocol: 'x402',
        paymentRequirements: {},
      });

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['Authorization']).toBeUndefined();
      expect(callHeaders['Content-Type']).toBe('application/json');
    });
  });
});
