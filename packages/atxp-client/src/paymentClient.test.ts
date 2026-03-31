import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import type { AuthorizeResult } from '@atxp/common';
import { PaymentClient, buildPaymentHeaders } from './paymentClient.js';
import { BigNumber } from 'bignumber.js';

function createMockAccount(authorizeImpl?: (params: any) => Promise<AuthorizeResult>) {
  return {
    token: 'test-token-123',
    getAccountId: async () => 'base:0xtest' as any,
    paymentMakers: [],
    getSources: async () => [],
    createSpendPermission: async () => null,
    authorize: authorizeImpl ?? vi.fn().mockResolvedValue({ protocol: 'atxp', credential: '{}' }),
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
    it('should delegate to account.authorize with x402 protocol', async () => {
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'x402',
        credential: 'x402-payment-header',
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account,
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        protocol: 'x402',
        paymentRequirements: { network: 'base', scheme: 'exact' },
      });

      expect(result.protocol).toBe('x402');
      expect(result.credential).toBe('x402-payment-header');

      // Verify account.authorize was called with correct params
      expect(mockAuthorize).toHaveBeenCalledWith({
        protocol: 'x402',
        amount: undefined,
        destination: 'https://example.com/api',
        memo: undefined,
        paymentRequirements: { network: 'base', scheme: 'exact' },
        challenge: undefined,
      });
    });

    it('should delegate to account.authorize with mpp protocol', async () => {
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'mpp',
        credential: 'mpp-credential-value',
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const challenge = { id: 'ch_1', method: 'tempo', amount: '1000000' };
      const result = await client.authorize({
        account,
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        protocol: 'mpp',
        challenge,
      });

      expect(result.protocol).toBe('mpp');
      expect(result.credential).toBe('mpp-credential-value');

      expect(mockAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'mpp', challenge })
      );
    });

    it('should delegate to account.authorize with atxp protocol', async () => {
      const responseBody = { transactionId: 'tx_123', status: 'completed', sourceAccountToken: 'test-token-123' };
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'atxp',
        credential: JSON.stringify(responseBody),
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account,
        userId: 'base:0xtest',
        destination: '0xrecipient',
        protocol: 'atxp',
        amount: new BigNumber('1.5'),
        memo: 'test payment',
      });

      expect(result.protocol).toBe('atxp');
      expect(result.credential).toBe(JSON.stringify(responseBody));

      expect(mockAuthorize).toHaveBeenCalledWith({
        protocol: 'atxp',
        amount: new BigNumber('1.5'),
        destination: '0xrecipient',
        memo: 'test payment',
        paymentRequirements: undefined,
        challenge: undefined,
      });
    });

    it('should use protocolFlag when no explicit protocol is provided', async () => {
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'mpp',
        credential: 'flag-cred',
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        protocolFlag: (_userId, _dest) => 'mpp',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account,
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        challenge: { id: 'ch_1' },
      });

      expect(result.protocol).toBe('mpp');
      expect(mockAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'mpp' })
      );
    });

    it('should default to atxp when no protocol or protocolFlag', async () => {
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'atxp',
        credential: '{"status":"ok"}',
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account,
        userId: 'base:0xtest',
        destination: '0xrecipient',
        amount: new BigNumber('1'),
      });

      expect(result.protocol).toBe('atxp');
      expect(mockAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'atxp' })
      );
    });

    it('should propagate errors from account.authorize', async () => {
      const mockAuthorize = vi.fn().mockRejectedValue(
        new Error('ATXPAccount: /authorize/x402 failed (404): Not Found')
      );
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      await expect(
        client.authorize({
          account,
          userId: 'base:0xtest',
          destination: 'https://example.com/api',
          protocol: 'x402',
          paymentRequirements: {},
        })
      ).rejects.toThrow('/authorize/x402 failed (404)');
    });

    it('should propagate missing paymentHeader errors from account.authorize', async () => {
      const mockAuthorize = vi.fn().mockRejectedValue(
        new Error('ATXPAccount: /authorize/x402 response missing or invalid paymentHeader')
      );
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      await expect(
        client.authorize({
          account,
          userId: 'base:0xtest',
          destination: 'https://example.com/api',
          protocol: 'x402',
          paymentRequirements: {},
        })
      ).rejects.toThrow('missing or invalid paymentHeader');
    });

    it('should propagate missing credential errors from account.authorize', async () => {
      const mockAuthorize = vi.fn().mockRejectedValue(
        new Error('ATXPAccount: /authorize/mpp response missing or invalid credential')
      );
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      await expect(
        client.authorize({
          account,
          userId: 'base:0xtest',
          destination: 'https://example.com/api',
          protocol: 'mpp',
          challenge: {},
        })
      ).rejects.toThrow('missing or invalid credential');
    });

    it('should work with accounts that have no token property', async () => {
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'x402',
        credential: 'cred',
      });

      const accountNoToken = {
        getAccountId: async () => 'base:0xtest' as any,
        paymentMakers: [],
        getSources: async () => [],
        createSpendPermission: async () => null,
        authorize: mockAuthorize,
      };

      const client = new PaymentClient({
        accountsServer: 'https://accounts.test.com',
        logger,
        fetchFn: mockFetch,
      });

      const result = await client.authorize({
        account: accountNoToken,
        userId: 'base:0xtest',
        destination: 'https://example.com/api',
        protocol: 'x402',
        paymentRequirements: {},
      });

      expect(result.credential).toBe('cred');
      expect(mockAuthorize).toHaveBeenCalled();
    });
  });
});
