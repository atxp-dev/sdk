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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authorize', () => {
    it('should delegate to account.authorize with protocols array', async () => {
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'x402',
        credential: 'x402-payment-header',
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({ logger });

      const result = await client.authorize({
        account,
        protocols: ['x402'],
        destination: 'https://example.com/api',
        paymentRequirements: { network: 'base', scheme: 'exact' },
      });

      expect(result.protocol).toBe('x402');
      expect(result.credential).toBe('x402-payment-header');

      // Verify account.authorize was called with correct params
      expect(mockAuthorize).toHaveBeenCalledWith({
        protocols: ['x402'],
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

      const client = new PaymentClient({ logger });

      const challenge = { id: 'ch_1', method: 'tempo', amount: '1000000' };
      const result = await client.authorize({
        account,
        protocols: ['mpp'],
        destination: 'https://example.com/api',
        challenge,
      });

      expect(result.protocol).toBe('mpp');
      expect(result.credential).toBe('mpp-credential-value');

      expect(mockAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({ protocols: ['mpp'], challenge })
      );
    });

    it('should delegate to account.authorize with atxp protocol', async () => {
      const responseBody = { transactionId: 'tx_123', status: 'completed', sourceAccountToken: 'test-token-123' };
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'atxp',
        credential: JSON.stringify(responseBody),
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({ logger });

      const result = await client.authorize({
        account,
        protocols: ['atxp'],
        destination: '0xrecipient',
        amount: new BigNumber('1.5'),
        memo: 'test payment',
      });

      expect(result.protocol).toBe('atxp');
      expect(result.credential).toBe(JSON.stringify(responseBody));

      expect(mockAuthorize).toHaveBeenCalledWith({
        protocols: ['atxp'],
        amount: new BigNumber('1.5'),
        destination: '0xrecipient',
        memo: 'test payment',
        paymentRequirements: undefined,
        challenge: undefined,
      });
    });

    it('should pass multiple protocols through to account.authorize', async () => {
      const mockAuthorize = vi.fn().mockResolvedValue({
        protocol: 'x402',
        credential: 'multi-cred',
      });
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({ logger });

      const result = await client.authorize({
        account,
        protocols: ['x402', 'atxp'],
        destination: 'https://example.com/api',
        paymentRequirements: { network: 'base' },
      });

      expect(result.protocol).toBe('x402');
      expect(mockAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({ protocols: ['x402', 'atxp'] })
      );
    });

    it('should propagate errors from account.authorize', async () => {
      const mockAuthorize = vi.fn().mockRejectedValue(
        new Error('ATXPAccount: /authorize/auto failed (404): Not Found')
      );
      const account = createMockAccount(mockAuthorize);

      const client = new PaymentClient({ logger });

      await expect(
        client.authorize({
          account,
          protocols: ['x402'],
          destination: 'https://example.com/api',
          paymentRequirements: {},
        })
      ).rejects.toThrow('/authorize/auto failed (404)');
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

      const client = new PaymentClient({ logger });

      const result = await client.authorize({
        account: accountNoToken,
        protocols: ['x402'],
        destination: 'https://example.com/api',
        paymentRequirements: {},
      });

      expect(result.credential).toBe('cred');
      expect(mockAuthorize).toHaveBeenCalled();
    });
  });
});
