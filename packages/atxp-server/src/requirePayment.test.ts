import { describe, it, expect, vi } from 'vitest';
import { requirePayment } from './index.js';
import * as TH from './serverTestHelpers.js';
import { BigNumber } from 'bignumber.js';
import { withATXPContext } from './atxpContext.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

describe('requirePayment', () => {
  it('should pass if there is money', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue({success: true, requiredPaymentId: null})});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      await expect(requirePayment({price: BigNumber(0.01)})).resolves.not.toThrow();
    });
  });

  it('should call the atxp server /charge endpoint', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue({success: true, requiredPaymentId: null})});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      await expect(requirePayment({price: BigNumber(0.01)})).resolves.not.toThrow();
      expect(paymentServer.charge).toHaveBeenCalledWith({
        amount: BigNumber(0.01),
        currency: config.currency,
        network: config.network,
        destination: config.destination,
        source: 'test-user',
        payeeName: config.payeeName,
      });
    });
  });

  it('should throw an error if there is no money', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue({success: false, requiredPaymentId: 'test-payment-request-id'})});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err).toBeInstanceOf(McpError);
      }
    });
  });

  it('should create a payment request if there is no money', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue({success: false, requiredPaymentId: 'test-payment-request-id'})});
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err).toBeInstanceOf(McpError);
        expect(paymentServer.createPaymentRequest).toHaveBeenCalledWith({
          amount: BigNumber(0.01),
          currency: config.currency,
          network: config.network,
          destination: config.destination,
          source: 'test-user',
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
        expect(err).not.toBeInstanceOf(McpError);
        expect(err.message).toContain('No user found');
      }
    });
  });

  it('error should include the elicitation url constructed from atxpServer() config', async () => {
    const paymentServer = TH.paymentServer({charge: vi.fn().mockResolvedValue({success: false, requiredPaymentId: 'test-payment-request-id'})});
    const config = TH.config({ paymentServer, server: 'https://example.com' });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err).toBeInstanceOf(McpError);
        expect(err.data.paymentRequestId).toBe('test-payment-request-id');
        expect(err.data.paymentRequestUrl).toBe('https://example.com/payment-request/test-payment-request-id');
      }
    });
  });

  it('should provide a way for consumer to do an idempotency check', async () => {
    const paymentServer = TH.paymentServer({ charge: vi.fn().mockResolvedValue({success: false, requiredPaymentId: 'test-payment-request-id'}) });
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01), getExistingPaymentId: async () => 'some-other-payment-id'});
      } catch (err: any) {
        expect(err).toBeInstanceOf(McpError);
        expect(err.data.paymentRequestId).toBe('some-other-payment-id');
        expect(err.data.paymentRequestUrl).toBe('https://auth.atxp.ai/payment-request/some-other-payment-id');
        expect(paymentServer.createPaymentRequest).not.toHaveBeenCalled();
      }
    });
  });

  it('should throw an error if the payment request fails', async () => {
    const paymentServer = TH.paymentServer({
      charge: vi.fn().mockResolvedValue({success: false, requiredPaymentId: 'test-payment-request-id'}),
      createPaymentRequest: vi.fn().mockRejectedValue(new Error('Payment request failed')),
    });
    const config = TH.config({ paymentServer });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      try {
        await requirePayment({price: BigNumber(0.01)});
      } catch (err: any) {
        expect(err).not.toBeInstanceOf(McpError);
        expect(err.message).toContain('Payment request failed');
      }
    });
  });

});