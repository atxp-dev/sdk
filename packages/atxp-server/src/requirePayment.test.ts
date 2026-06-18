import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requirePayment } from './index.js';
import * as TH from './serverTestHelpers.js';
import { BigNumber } from 'bignumber.js';
import { withATXPContext, openPaymentSession, paymentSession } from './atxpContext.js';
import { PAYMENT_REQUIRED_ERROR_CODE } from '@atxp/common';
import { ProtocolSettlement } from './protocol.js';

describe('requirePayment', () => {
  // The omni-challenge build path fetches GET /x402/supported (upto facilitator
  // addresses). Stub it so tests don't make real network calls; an empty map
  // means the challenge advertises x402 exact only (the existing expectations).
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should pass if there is money', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue(true)});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      await expect(requirePayment({price: BigNumber(0.01)})).resolves.not.toThrow();
    });
  });

  it('should call the atxp server /charge endpoint', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue(true)});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      await expect(requirePayment({price: BigNumber(0.01)})).resolves.not.toThrow();
      expect(paymentServer.charge).toHaveBeenCalledWith({
        options: [{
          network: 'base',
          currency: config.currency,
          address: TH.DESTINATION,
          amount: BigNumber(0.01)
        }],
        sourceAccountId: 'test-user',
        sourceAccountToken: 'test-token',
        destinationAccountId: `base:${TH.DESTINATION}`,
        payeeName: config.payeeName,
      });
    });
  });

  it('should throw an error if there is no money', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue(false)});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);
      }
    });
  });

  it('should create a payment request if there is no money', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue(false)});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);
        expect(paymentServer.createPaymentRequest).toHaveBeenCalledWith({
          options: [{
            network: 'base',
            currency: config.currency,
            address: TH.DESTINATION,
            amount: BigNumber(0.01)
          }],
          sourceAccountId: 'test-user',
          destinationAccountId: `base:${TH.DESTINATION}`,
          payeeName: config.payeeName,
        });
      }
    });
  });

  it('should throw an error if the user is not set', async () => {
    const paymentServer = TH.paymentServer();
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), null, async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err.code).not.toBe(PAYMENT_REQUIRED_ERROR_CODE);
        expect(err.message).toContain('No user found');
      }
    });
  });

  it('error should include the elicitation url constructed from atxpServer() config', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue(false)});
    const config = TH.config({ paymentServer, server: 'https://example.com' });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);
        expect(err.data.paymentRequestId).toBe('test-payment-request-id');
        expect(err.data.paymentRequestUrl).toBe('https://example.com/payment-request/test-payment-request-id');
      }
    });
  });

  it('should provide a way for consumer to do an idempotency check', async () => {
    const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(false) });
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01), getExistingPaymentId: async () => 'some-other-payment-id'});
      } catch (err: any) {
        expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);
        expect(err.data.paymentRequestId).toBe('some-other-payment-id');
        expect(err.data.paymentRequestUrl).toBe('https://auth.atxp.ai/payment-request/some-other-payment-id');
        expect(paymentServer.createPaymentRequest).not.toHaveBeenCalled();
      }
    });
  });

  it('should throw an error if the payment request fails', async () => {
    const paymentServer = TH.paymentServer({
      charge: vi.fn().mockResolvedValue(false),
      createPaymentRequest: vi.fn().mockRejectedValue(new Error('Payment request failed')),
    });
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err.code).not.toBe(PAYMENT_REQUIRED_ERROR_CODE);
        expect(err.message).toContain('Payment request failed');
      }
    });
  });

  describe('minimumPayment override', () => {
    it('should use minimumPayment from config when provided, passing to createPaymentRequest', async () => {
      const paymentServer = TH.paymentServer({
        charge: vi.fn().mockResolvedValue(false)
      });
      const config = TH.config({
        paymentServer,
        minimumPayment: BigNumber(0.05) // Override amount
      });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        try {
          await requirePayment({price: BigNumber(0.01)}); // Request 0.01
        } catch (err: any) {
          expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);

          // Verify charge was called with requested amount (0.01), NOT minimumPayment
          expect(paymentServer.charge).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.01) // charge uses requested amount
            }],
            sourceAccountId: 'test-user',
            sourceAccountToken: 'test-token',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });

          // Should use minimumPayment (0.05) for createPaymentRequest
          expect(paymentServer.createPaymentRequest).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.05) // Uses minimumPayment override
            }],
            sourceAccountId: 'test-user',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });
        }
      });
    });

    it('should NOT use minimumPayment for charge call - always use requested amount', async () => {
      const paymentServer = TH.paymentServer({
        charge: vi.fn().mockResolvedValue(true)
      });
      const config = TH.config({
        paymentServer,
        minimumPayment: BigNumber(0.05) // Override amount
      });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        await requirePayment({price: BigNumber(0.01)}); // Request 0.01

        // Should ALWAYS use requested amount (0.01) for charge, NOT minimumPayment
        expect(paymentServer.charge).toHaveBeenCalledWith({
          options: [{
            network: 'base',
            currency: config.currency,
            address: TH.DESTINATION,
            amount: BigNumber(0.01) // charge ALWAYS uses the requested amount, not minimumPayment
          }],
          sourceAccountId: 'test-user',
          sourceAccountToken: 'test-token',
          destinationAccountId: `base:${TH.DESTINATION}`,
          payeeName: config.payeeName,
        });
      });
    });

    it('should use requirePayment amount when minimumPayment is not specified', async () => {
      const paymentServer = TH.paymentServer({
        charge: vi.fn().mockResolvedValue(false)
      });
      const config = TH.config({
        paymentServer
        // No minimumPayment specified
      });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        try {
          await requirePayment({price: BigNumber(0.01)}); // Request 0.01
        } catch (err: any) {
          expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);

          // Verify charge was called with requested amount (0.01)
          expect(paymentServer.charge).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.01) // charge uses requested amount
            }],
            sourceAccountId: 'test-user',
            sourceAccountToken: 'test-token',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });

          // Should use the requested amount (0.01) for createPaymentRequest
          expect(paymentServer.createPaymentRequest).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.01) // Uses requested amount
            }],
            sourceAccountId: 'test-user',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });
        }
      });
    });
  });

  describe('minimumPayment with price comparison', () => {
    it('should use requested price when it exceeds minimumPayment for both charge and createPaymentRequest', async () => {
      const paymentServer = TH.paymentServer({
        charge: vi.fn().mockResolvedValue(false)
      });
      const config = TH.config({
        paymentServer,
        minimumPayment: BigNumber(0.05) // Minimum is $0.05
      });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        try {
          await requirePayment({price: BigNumber(0.10)}); // Request $0.10, which is higher than minimum
        } catch (err: any) {
          expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);

          // Should use requested amount (0.10) for charge since it's higher than minimumPayment
          expect(paymentServer.charge).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.10) // Uses requested amount
            }],
            sourceAccountId: 'test-user',
            sourceAccountToken: 'test-token',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });

          // Should also use requested amount (0.10) for createPaymentRequest since it's higher
          expect(paymentServer.createPaymentRequest).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.10) // Uses requested amount, not minimumPayment
            }],
            sourceAccountId: 'test-user',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });
        }
      });
    });

    it('should use minimumPayment when it exceeds requested price for createPaymentRequest only', async () => {
      const paymentServer = TH.paymentServer({
        charge: vi.fn().mockResolvedValue(false)
      });
      const config = TH.config({
        paymentServer,
        minimumPayment: BigNumber(0.05) // Minimum is $0.05
      });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        try {
          await requirePayment({price: BigNumber(0.01)}); // Request $0.01, which is lower than minimum
        } catch (err: any) {
          expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);

          // Should use requested amount (0.01) for charge
          expect(paymentServer.charge).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.01) // Uses requested amount for charge
            }],
            sourceAccountId: 'test-user',
            sourceAccountToken: 'test-token',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });

          // Should use minimumPayment (0.05) for createPaymentRequest since it's higher
          expect(paymentServer.createPaymentRequest).toHaveBeenCalledWith({
            options: [{
              network: 'base',
              currency: config.currency,
              address: TH.DESTINATION,
              amount: BigNumber(0.05) // Uses minimumPayment since it's higher
            }],
            sourceAccountId: 'test-user',
            destinationAccountId: `base:${TH.DESTINATION}`,
            payeeName: config.payeeName,
          });
        }
      });
    });
  });

  // Settlement is now handled at response close via the implicit PaymentSession,
  // not by requirePayment() itself. requirePayment() only records local charges.
  // See atxpExpress.test.ts for the settle-at-close integration tests.
  describe('requirePayment does not settle directly', () => {
    it('should charge directly without settling — settlement happens at session close', async () => {
      const mockSettle = vi.fn();
      vi.spyOn(ProtocolSettlement.prototype, 'settle').mockImplementation(mockSettle);

      const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(true) });
      const config = TH.config({ paymentServer });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        await expect(requirePayment({ price: BigNumber(0.01) })).resolves.not.toThrow();
        expect(mockSettle).not.toHaveBeenCalled();
        expect(paymentServer.charge).toHaveBeenCalled();
      });

      vi.restoreAllMocks();
    });
  });

  // When the middleware has opened an implicit PaymentSession, requirePayment()
  // charges it locally instead of debiting the auth ledger via paymentServer.charge.
  describe('implicit PaymentSession charging', () => {
    const atxpCredential = {
      protocol: 'atxp' as const,
      // No amount in the credential → cap is Infinity (best-effort Phase 1),
      // so the local charge always succeeds.
      credential: JSON.stringify({ sourceAccountId: 'test-user', sourceAccountToken: 'tok' }),
    };

    it('charges the session locally and does NOT call paymentServer.charge', async () => {
      const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(true) });
      const config = TH.config({ paymentServer });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        openPaymentSession(atxpCredential, {});
        await expect(requirePayment({ price: BigNumber(0.01) })).resolves.not.toThrow();

        expect(paymentServer.charge).not.toHaveBeenCalled();
        expect(paymentSession()!.spent.toNumber()).toBeCloseTo(0.01);
      });
    });

    it('accumulates multiple charges into one session', async () => {
      const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(true) });
      const config = TH.config({ paymentServer });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        openPaymentSession(atxpCredential, {});
        await requirePayment({ price: BigNumber(0.01) });
        await requirePayment({ price: BigNumber(0.02) });

        expect(paymentServer.charge).not.toHaveBeenCalled();
        expect(paymentSession()!.spent.toNumber()).toBeCloseTo(0.03);
      });
    });

    it('creates a payment request and throws when a charge would exceed the cap', async () => {
      const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(true) });
      const config = TH.config({ paymentServer });

      // x402 session capped at 0.01 USDC; a 0.02 charge exceeds it.
      const x402Credential = {
        protocol: 'x402' as const,
        credential: 'x402-cred',
      };

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        openPaymentSession(x402Credential, { paymentRequirements: { amount: '10000' } });
        try {
          await requirePayment({ price: BigNumber(0.02) });
          throw new Error('expected requirePayment to throw a payment challenge');
        } catch (err: any) {
          expect(err.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);
          // Did not fall through to ledger charge — session path was used.
          expect(paymentServer.charge).not.toHaveBeenCalled();
          expect(paymentServer.createPaymentRequest).toHaveBeenCalled();
          // Nothing recorded against the session.
          expect(paymentSession()!.spent.toNumber()).toBe(0);
        }
      });
    });
  });

});