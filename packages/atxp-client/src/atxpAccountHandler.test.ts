import { describe, it, expect, vi } from 'vitest';
import { ATXPAccountHandler } from './atxpAccountHandler.js';
import type { ProtocolConfig } from './protocolHandler.js';
import type { Account } from '@atxp/common';

function createMockAccount(overrides?: Partial<Account>): Account {
  return {
    getAccountId: vi.fn().mockResolvedValue('atxp:test-account'),
    paymentMakers: [],
    usesAccountsAuthorize: true,
    getSources: vi.fn().mockResolvedValue([]),
    createSpendPermission: vi.fn().mockResolvedValue(null),
    authorize: vi.fn().mockResolvedValue({ protocol: 'atxp', credential: '{"token":"abc"}' }),
    ...overrides,
  } as unknown as Account;
}

function createMockConfig(overrides?: Partial<ProtocolConfig>): ProtocolConfig {
  return {
    account: createMockAccount(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    fetchFn: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
    approvePayment: vi.fn().mockResolvedValue(true),
    onPayment: vi.fn(),
    onPaymentFailure: vi.fn(),
    ...overrides,
  };
}

function make402Response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ATXPAccountHandler', () => {
  const handler = new ATXPAccountHandler();

  describe('canHandle', () => {
    it('returns true for 402 responses', async () => {
      const response = new Response('', { status: 402 });
      expect(await handler.canHandle(response)).toBe(true);
    });

    it('returns false for 200 responses', async () => {
      const response = new Response('ok', { status: 200 });
      expect(await handler.canHandle(response)).toBe(false);
    });
  });

  describe('handlePaymentChallenge', () => {
    it('delegates to account.authorize() and retries with payment header', async () => {
      const authorize = vi.fn().mockResolvedValue({ protocol: 'atxp', credential: '{"token":"abc"}' });
      const account = createMockAccount({ authorize });
      const retryResponse = new Response('paid', { status: 200 });
      const fetchFn = vi.fn().mockResolvedValue(retryResponse);
      const config = createMockConfig({ account, fetchFn });

      const response = make402Response({ chargeAmount: '0.01' });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config,
      );

      expect(authorize).toHaveBeenCalledTimes(1);
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          protocols: ['atxp', 'x402', 'mpp'],
          amount: expect.anything(),
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toBe(retryResponse);
    });

    it('returns null when authorize throws', async () => {
      const authorize = vi.fn().mockRejectedValue(new Error('auth failed'));
      const account = createMockAccount({ authorize });
      const config = createMockConfig({ account });

      const response = make402Response({ chargeAmount: '0.01' });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config,
      );

      expect(result).toBeNull();
      expect(config.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('authorize failed'),
      );
    });

    it('returns null when no amount in challenge data', async () => {
      const config = createMockConfig();

      // Challenge with no chargeAmount, no x402, no mpp
      const response = make402Response({ someOtherField: 'value' });
      const result = await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config,
      );

      expect(result).toBeNull();
      expect(config.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('no amount in challenge data'),
      );
    });
  });

  describe('buildAuthorizeParams (via handlePaymentChallenge)', () => {
    it('passes full x402 accepts array to accounts, skipping network=atxp', async () => {
      const authorize = vi.fn().mockResolvedValue({ protocol: 'x402', credential: 'x402-cred' });
      const account = createMockAccount({ authorize });
      const fetchFn = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
      const config = createMockConfig({ account, fetchFn });

      const response = make402Response({
        chargeAmount: '1000000',
        x402: {
          x402Version: 2,
          accepts: [
            { network: 'atxp', payTo: 'atxp_acct_123' },
            { network: 'eip155:8453', payTo: '0xDEST', amount: '1000000' },
            { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: 'SolDest', amount: '1000000' },
          ],
        },
      });

      await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config,
      );

      // Full accepts passed (minus atxp) — accounts picks chain via feature flag
      const callArgs = authorize.mock.calls[0][0];
      expect(callArgs.destination).toBe('0xDEST'); // from first non-atxp option
      expect(callArgs.paymentRequirements.x402Version).toBe(2);
      expect(callArgs.paymentRequirements.accepts).toHaveLength(2); // atxp filtered
      expect(callArgs.paymentRequirements.accepts[0].network).toBe('eip155:8453');
      expect(callArgs.paymentRequirements.accepts[1].network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    });

    it('fetches payment request when no x402 data provides a destination', async () => {
      const authorize = vi.fn().mockResolvedValue({ protocol: 'atxp', credential: '{}' });
      const account = createMockAccount({ authorize });

      // Mock fetchFn: the first call (for the payment request) returns options;
      // the second call (for the retry) returns 200.
      const prResponse = new Response(JSON.stringify({
        options: [{ address: '0xFromPR', network: 'base', amount: '500000' }],
      }), { status: 200 });
      const retryResponse = new Response('ok', { status: 200 });
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(prResponse)
        .mockResolvedValueOnce(retryResponse);

      const config = createMockConfig({ account, fetchFn });

      const response = make402Response({
        chargeAmount: '0.50',
        paymentRequestUrl: 'https://auth.atxp.ai/payment-request/pr_123',
      });

      await handler.handlePaymentChallenge(
        response,
        { url: 'https://example.com/api' },
        config,
      );

      // First fetchFn call is the payment request fetch
      expect(fetchFn).toHaveBeenCalledWith('https://auth.atxp.ai/payment-request/pr_123');
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: '0xFromPR',
        }),
      );
    });
  });
});
