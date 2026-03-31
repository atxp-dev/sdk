import { describe, it, expect } from 'vitest';
import { BigNumber } from 'bignumber.js';
import {
  buildX402Requirements,
  buildAtxpMcpChallenge,
  omniChallengeMcpError,
  omniChallengeHttpResponse,
  buildOmniChallenge,
} from './omniChallenge.js';
import { PAYMENT_REQUIRED_ERROR_CODE, PAYMENT_REQUIRED_PREAMBLE } from '@atxp/common';

describe('omniChallenge', () => {
  const defaultOptions = [
    { network: 'base', currency: 'USDC', address: '0xDestination', amount: new BigNumber('0.01') },
  ];

  describe('buildX402Requirements', () => {
    it('should build valid X402 payment requirements', () => {
      const result = buildX402Requirements({
        options: defaultOptions,
        resource: 'https://example.com/api',
        payeeName: 'Test Server',
      });

      expect(result.x402Version).toBe(1);
      expect(result.accepts).toHaveLength(1);
      expect(result.accepts[0]).toMatchObject({
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '10000', // 0.01 * 1e6
        resource: 'https://example.com/api',
        description: 'Test Server',
        payTo: '0xDestination',
      });
    });

    it('should handle multiple payment options', () => {
      const options = [
        { network: 'base', currency: 'USDC', address: '0xAddr1', amount: new BigNumber('0.01') },
        { network: 'solana', currency: 'USDC', address: 'SolAddr', amount: new BigNumber('0.02') },
      ];

      const result = buildX402Requirements({
        options,
        resource: 'https://example.com',
        payeeName: 'Multi-chain Server',
      });

      expect(result.accepts).toHaveLength(2);
      expect(result.accepts[0].payTo).toBe('0xAddr1');
      expect(result.accepts[1].payTo).toBe('SolAddr');
    });
  });

  describe('buildAtxpMcpChallenge', () => {
    it('should build ATXP-MCP challenge data', () => {
      const result = buildAtxpMcpChallenge(
        'https://auth.atxp.ai' as any,
        'pr_123',
        new BigNumber('0.05'),
      );

      expect(result).toEqual({
        paymentRequestId: 'pr_123',
        paymentRequestUrl: 'https://auth.atxp.ai/payment-request/pr_123',
        chargeAmount: '0.05',
      });
    });

    it('should omit chargeAmount when not provided', () => {
      const result = buildAtxpMcpChallenge(
        'https://auth.atxp.ai' as any,
        'pr_456',
      );

      expect(result.chargeAmount).toBeUndefined();
    });
  });

  describe('omniChallengeMcpError', () => {
    it('should emit MCP error containing both ATXP-MCP and X402 data', () => {
      const x402 = buildX402Requirements({
        options: defaultOptions,
        resource: 'https://example.com',
        payeeName: 'Test',
      });

      const error = omniChallengeMcpError(
        'https://auth.atxp.ai' as any,
        'pr_789',
        new BigNumber('0.01'),
        x402,
      );

      expect(error.code).toBe(PAYMENT_REQUIRED_ERROR_CODE);
      expect(error.message).toContain(PAYMENT_REQUIRED_PREAMBLE);
      expect(error.message).toContain('pr_789');

      const data = error.data as any;
      // ATXP-MCP fields
      expect(data.paymentRequestId).toBe('pr_789');
      expect(data.paymentRequestUrl).toBe('https://auth.atxp.ai/payment-request/pr_789');
      expect(data.chargeAmount).toBe('0.01');

      // X402 fields
      expect(data.x402).toBeDefined();
      expect(data.x402.x402Version).toBe(1);
      expect(data.x402.accepts).toHaveLength(1);
      expect(data.x402.accepts[0].payTo).toBe('0xDestination');
    });
  });

  describe('omniChallengeHttpResponse', () => {
    it('should emit HTTP 402 with X402 body and X-ATXP-Payment-Request header', () => {
      const x402 = buildX402Requirements({
        options: defaultOptions,
        resource: 'https://example.com',
        payeeName: 'Test',
      });

      const response = omniChallengeHttpResponse(
        'https://auth.atxp.ai' as any,
        'pr_abc',
        new BigNumber('0.01'),
        x402,
      );

      expect(response.status).toBe(402);

      // Body should be X402 format
      const body = JSON.parse(response.body);
      expect(body.x402Version).toBe(1);
      expect(body.accepts).toHaveLength(1);
      expect(body.accepts[0].payTo).toBe('0xDestination');

      // Header should contain ATXP-MCP data
      expect(response.headers['X-ATXP-Payment-Request']).toBeDefined();
      const atxpHeader = JSON.parse(response.headers['X-ATXP-Payment-Request']);
      expect(atxpHeader.paymentRequestId).toBe('pr_abc');
      expect(atxpHeader.paymentRequestUrl).toBe('https://auth.atxp.ai/payment-request/pr_abc');
    });
  });

  describe('buildOmniChallenge', () => {
    it('should build a complete omni-challenge with both protocol data', () => {
      const challenge = buildOmniChallenge({
        server: 'https://auth.atxp.ai' as any,
        paymentRequestId: 'pr_full',
        chargeAmount: new BigNumber('0.10'),
        options: defaultOptions,
        resource: 'https://example.com/resource',
        payeeName: 'Full Test',
      });

      // ATXP-MCP data
      expect(challenge.atxpMcp.paymentRequestId).toBe('pr_full');
      expect(challenge.atxpMcp.paymentRequestUrl).toContain('pr_full');
      expect(challenge.atxpMcp.chargeAmount).toBe('0.1');

      // X402 data
      expect(challenge.x402.x402Version).toBe(1);
      expect(challenge.x402.accepts).toHaveLength(1);
    });
  });
});
