import { describe, it, expect, vi } from 'vitest';
import { requirePayment } from './index.js';
import * as TH from './serverTestHelpers.js';
import { BigNumber } from 'bignumber.js';
import { withATXPContext, setDetectedCredential } from './atxpContext.js';
import { OMNI_PAYMENT_ERROR_CODE } from '@atxp/common';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ProtocolSettlement } from './protocol.js';

describe('requirePayment', () => {
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
        expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);
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
        expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);
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
        expect(err.code).not.toBe(OMNI_PAYMENT_ERROR_CODE);
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
        expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);
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
        expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);
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
        expect(err.code).not.toBe(OMNI_PAYMENT_ERROR_CODE);
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
          expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);

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
          expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);

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
          expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);

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
          expect(err.code).toBe(OMNI_PAYMENT_ERROR_CODE);

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

  describe('settlement of detected credentials', () => {
    it('should settle credential and succeed when charge passes after settlement', async () => {
      const mockSettle = vi.fn().mockResolvedValue({ txHash: '0xabc', settledAmount: '10000' });
      vi.spyOn(ProtocolSettlement.prototype, 'settle').mockImplementation(mockSettle);

      const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(true) });
      const config = TH.config({ paymentServer });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        setDetectedCredential({ protocol: 'x402', credential: 'dGVzdA==', sourceAccountId: 'base:0x123' });
        await expect(requirePayment({ price: BigNumber(0.01) })).resolves.not.toThrow();
        expect(mockSettle).toHaveBeenCalledWith('x402', 'dGVzdA==', expect.objectContaining({
          destinationAccountId: `base:${TH.DESTINATION}`,
        }));
        expect(paymentServer.charge).toHaveBeenCalled();
      });

      vi.restoreAllMocks();
    });

    it('should throw McpError when settlement fails instead of falling through silently', async () => {
      const mockSettle = vi.fn().mockRejectedValue(new Error('on-chain tx reverted'));
      vi.spyOn(ProtocolSettlement.prototype, 'settle').mockImplementation(mockSettle);

      const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(false) });
      const config = TH.config({ paymentServer });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        setDetectedCredential({ protocol: 'x402', credential: 'dGVzdA==', sourceAccountId: 'base:0x123' });
        try {
          await requirePayment({ price: BigNumber(0.01) });
          expect.fail('should have thrown');
        } catch (err: unknown) {
          // Should be an McpError with settlement failure details, NOT an omni-challenge
          expect(err).toBeInstanceOf(McpError);
          const mcpErr = err as McpError;
          expect(mcpErr.code).toBe(-32000);
          expect(mcpErr.message).toContain('Payment settlement failed for x402');
          expect((mcpErr.data as Record<string, unknown>)?.reason).toBe('on-chain tx reverted');
          // charge() should NOT have been called — we threw before reaching it
          expect(paymentServer.charge).not.toHaveBeenCalled();
        }
      });

      vi.restoreAllMocks();
    });

    it('should skip settlement and proceed to normal charge when no credential detected', async () => {
      const mockSettle = vi.fn();
      vi.spyOn(ProtocolSettlement.prototype, 'settle').mockImplementation(mockSettle);

      const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue(true) });
      const config = TH.config({ paymentServer });

      await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
        // No setDetectedCredential call — no credential on this request
        await expect(requirePayment({ price: BigNumber(0.01) })).resolves.not.toThrow();
        expect(mockSettle).not.toHaveBeenCalled();
        expect(paymentServer.charge).toHaveBeenCalled();
      });

      vi.restoreAllMocks();
    });
  });

});