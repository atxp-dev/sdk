import { describe, it, expect } from 'vitest';
import { BigNumber } from 'bignumber.js';
import {
  buildX402Requirements,
  buildAtxpMcpChallenge,
  buildMppChallenge,
  buildMppChallenges,
  serializeMppHeader,
  omniChallengeMcpError,
  omniChallengeHttpResponse,
  buildOmniChallenge,
  buildPaymentOptions,
  buildAuthorizeParamsFromSources,
} from './omniChallenge.js';
import { PAYMENT_REQUIRED_PREAMBLE } from '@atxp/common';
import { parseMPPHeader, MPP_ERROR_CODE } from '@atxp/mpp';

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

      expect(result.x402Version).toBe(2);
      expect(result.accepts).toHaveLength(1);
      expect(result.accepts[0]).toMatchObject({
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '10000', // 0.01 * 1e6
        resource: 'https://example.com/api',
        description: 'Test Server',
        mimeType: 'application/json',
        payTo: '0xDestination',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      });
    });

    it('should include both EVM and Solana X402 options', () => {
      const options = [
        { network: 'base', currency: 'USDC', address: '0xAddr1', amount: new BigNumber('0.01') },
        { network: 'solana', currency: 'USDC', address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', amount: new BigNumber('0.02') },
        { network: 'base', currency: 'USDC', address: '0xAddr2', amount: new BigNumber('0.03') },
      ];

      const result = buildX402Requirements({
        options,
        resource: 'https://example.com',
        payeeName: 'Multi-chain Server',
      });

      // EVM options first, then Solana
      expect(result.accepts).toHaveLength(3);
      expect(result.accepts[0].payTo).toBe('0xAddr1');
      expect(result.accepts[1].payTo).toBe('0xAddr2');
      expect(result.accepts[2].payTo).toBe('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV');
    });

    it('should include feePayer in extra for Solana X402 options', () => {
      const options = [
        { network: 'solana', currency: 'USDC', address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', amount: new BigNumber('0.01') },
      ];

      const result = buildX402Requirements({
        options,
        resource: 'https://example.com',
        payeeName: 'Solana Server',
      });

      expect(result.accepts).toHaveLength(1);
      expect(result.accepts[0].extra).toHaveProperty('feePayer');
      expect(result.accepts[0].extra.feePayer).toBe('BFK9TLC3edb13K6v4YyH3DwPb5DSUpkWvb7XnqCL9b4F');
      expect(result.accepts[0].network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
      expect(result.accepts[0].asset).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('should filter out Solana addresses that are too short (invalid base58)', () => {
      const options = [
        { network: 'base', currency: 'USDC', address: '0xAddr1', amount: new BigNumber('0.01') },
        { network: 'solana', currency: 'USDC', address: 'ShortAddr', amount: new BigNumber('0.02') },
      ];

      const result = buildX402Requirements({
        options,
        resource: 'https://example.com',
        payeeName: 'Test',
      });

      // Only Base option included — short Solana address filtered out
      expect(result.accepts).toHaveLength(1);
      expect(result.accepts[0].payTo).toBe('0xAddr1');
    });

    it('should include EIP-712 domain in extra for EVM options but not Solana', () => {
      const options = [
        { network: 'base', currency: 'USDC', address: '0xAddr1', amount: new BigNumber('0.01') },
        { network: 'solana', currency: 'USDC', address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', amount: new BigNumber('0.01') },
      ];

      const result = buildX402Requirements({
        options,
        resource: 'https://example.com',
        payeeName: 'Test',
      });

      // EVM has EIP-712 domain
      expect(result.accepts[0].extra).toEqual({ name: 'USD Coin', version: '2' });
      // Solana has feePayer, not EIP-712 domain
      expect(result.accepts[1].extra).toHaveProperty('feePayer');
      expect(result.accepts[1].extra).not.toHaveProperty('name');
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

      expect(error.code).toBe(MPP_ERROR_CODE);
      expect(error.message).toContain(PAYMENT_REQUIRED_PREAMBLE);
      expect(error.message).toContain('pr_789');

      const data = error.data as any;
      // ATXP-MCP fields
      expect(data.paymentRequestId).toBe('pr_789');
      expect(data.paymentRequestUrl).toBe('https://auth.atxp.ai/payment-request/pr_789');
      expect(data.chargeAmount).toBe('0.01');

      // X402 fields
      expect(data.x402).toBeDefined();
      expect(data.x402.x402Version).toBe(2);
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
      expect(body.x402Version).toBe(2);
      expect(body.accepts).toHaveLength(1);
      expect(body.accepts[0].payTo).toBe('0xDestination');

      // Header should contain ATXP-MCP data
      expect(response.headers['X-ATXP-Payment-Request']).toBeDefined();
      const atxpHeader = JSON.parse(response.headers['X-ATXP-Payment-Request']);
      expect(atxpHeader.paymentRequestId).toBe('pr_abc');
      expect(atxpHeader.paymentRequestUrl).toBe('https://auth.atxp.ai/payment-request/pr_abc');
    });
  });

  describe('buildMppChallenge', () => {
    it('should build MPP challenge from Tempo option with human-readable amount and expires', () => {
      const options = [
        { network: 'base', currency: 'USDC', address: '0xBase', amount: new BigNumber('0.01') },
        { network: 'tempo', currency: 'pathUSD', address: '0xTempo', amount: new BigNumber('0.01') },
      ];

      const result = buildMppChallenge({ id: 'ch_123', options });
      expect(result).toMatchObject({
        id: 'ch_123',
        method: 'tempo',
        intent: 'charge',
        amount: '0.01',
        currency: 'pathUSD',
        network: 'tempo',
        recipient: '0xTempo',
      });
      // Tempo challenges include expires; Solana does not
      expect(result!.expires).toBeDefined();
      expect(new Date(result!.expires!).getTime()).toBeGreaterThan(Date.now());
    });

    it('should accept tempo_moderato (testnet) as a Tempo option', () => {
      const options = [
        { network: 'tempo_moderato', currency: 'pathUSD', address: '0xTestnet', amount: new BigNumber('0.05') },
      ];

      const result = buildMppChallenge({ id: 'ch_testnet', options });
      expect(result).not.toBeNull();
      expect(result!.network).toBe('tempo_moderato');
      expect(result!.recipient).toBe('0xTestnet');
    });

    it('should return null when no Tempo option is available', () => {
      const result = buildMppChallenge({ id: 'ch_456', options: defaultOptions });
      expect(result).toBeNull();
    });
  });

  describe('buildMppChallenges amount format and expires', () => {
    it('Solana challenges use micro-units and have no expires', () => {
      const options = [
        { network: 'solana', currency: 'USDC', address: 'SolAddr', amount: new BigNumber('0.01') },
      ];
      const result = buildMppChallenges({ id: 'ch_sol', options });
      expect(result).toHaveLength(1);
      expect(result![0].amount).toBe('10000'); // 0.01 * 10^6
      expect(result![0].expires).toBeUndefined();
    });

    it('Tempo challenges use human-readable amount and include expires', () => {
      const options = [
        { network: 'tempo', currency: 'USDC', address: '0xTempo', amount: new BigNumber('1.5') },
      ];
      const result = buildMppChallenges({ id: 'ch_tempo', options });
      expect(result).toHaveLength(1);
      expect(result![0].amount).toBe('1.5'); // human-readable, not micro-units
      expect(result![0].expires).toBeDefined();
    });

    it('multi-chain challenges have different amount formats per chain', () => {
      const options = [
        { network: 'solana', currency: 'USDC', address: 'SolAddr', amount: new BigNumber('0.01') },
        { network: 'tempo', currency: 'USDC', address: '0xTempo', amount: new BigNumber('0.01') },
      ];
      const result = buildMppChallenges({ id: 'ch_multi', options });
      expect(result).toHaveLength(2);
      const solana = result!.find(c => c.method === 'solana')!;
      const tempo = result!.find(c => c.method === 'tempo')!;
      expect(solana.amount).toBe('10000');
      expect(solana.expires).toBeUndefined();
      expect(tempo.amount).toBe('0.01');
      expect(tempo.expires).toBeDefined();
    });
  });

  describe('serializeMppHeader', () => {
    it('should serialize MPP challenge to WWW-Authenticate header value', () => {
      const challenge = {
        id: 'ch_789',
        method: 'tempo',
        intent: 'charge',
        amount: '10000',
        currency: 'pathUSD',
        network: 'tempo',
        recipient: '0xRecipient',
      };

      const header = serializeMppHeader(challenge);
      expect(header).toContain('Payment');
      expect(header).toContain('method="tempo"');
      expect(header).toContain('id="ch_789"');
      expect(header).toContain('amount="10000"');
      expect(header).toContain('recipient="0xRecipient"');
    });

    it('should round-trip through parseMPPHeader', () => {
      const original = {
        id: 'ch_roundtrip',
        method: 'tempo',
        intent: 'charge',
        amount: '50000',
        currency: 'pathUSD',
        network: 'tempo',
        recipient: '0xABCDEF1234567890',
      };

      const header = serializeMppHeader(original);
      const parsed = parseMPPHeader(header);
      expect(parsed).toEqual(original);
    });

    it('should round-trip expires through serialize → parse', () => {
      const original = {
        id: 'ch_expires',
        method: 'tempo',
        intent: 'charge',
        amount: '0.01',
        currency: 'USDC',
        network: 'tempo',
        recipient: '0xRecipient',
        expires: '2026-04-10T00:00:00.000Z',
      };

      const header = serializeMppHeader(original);
      expect(header).toContain('expires="2026-04-10T00:00:00.000Z"');
      const parsed = parseMPPHeader(header);
      expect(parsed!.expires).toBe('2026-04-10T00:00:00.000Z');
    });
  });

  describe('omniChallengeMcpError with MPP', () => {
    it('should include MPP data in MCP error when provided', () => {
      const x402 = buildX402Requirements({
        options: defaultOptions,
        resource: 'https://example.com',
        payeeName: 'Test',
      });
      const mpp = { id: 'ch_mcp', method: 'tempo', intent: 'charge', amount: '10000', currency: 'pathUSD', network: 'tempo', recipient: '0xR' };

      const error = omniChallengeMcpError(
        'https://auth.atxp.ai' as any,
        'pr_mpp',
        new BigNumber('0.01'),
        x402,
        mpp,
      );

      const data = error.data as any;
      // data.mpp is now an array (multi-chain support)
      expect(data.mpp).toEqual([mpp]);
      expect(data.x402).toBeDefined();
      expect(data.paymentRequestId).toBe('pr_mpp');
    });

    it('should not include MPP data when not provided', () => {
      const x402 = buildX402Requirements({
        options: defaultOptions,
        resource: 'https://example.com',
        payeeName: 'Test',
      });

      const error = omniChallengeMcpError(
        'https://auth.atxp.ai' as any,
        'pr_no_mpp',
        new BigNumber('0.01'),
        x402,
      );

      const data = error.data as any;
      expect(data.mpp).toBeUndefined();
    });
  });

  describe('omniChallengeHttpResponse with MPP', () => {
    it('should include WWW-Authenticate: Payment header when MPP provided', () => {
      const x402 = buildX402Requirements({
        options: defaultOptions,
        resource: 'https://example.com',
        payeeName: 'Test',
      });
      const mpp = { id: 'ch_http', method: 'tempo', intent: 'charge', amount: '10000', currency: 'pathUSD', network: 'tempo', recipient: '0xR' };

      const response = omniChallengeHttpResponse(
        'https://auth.atxp.ai' as any,
        'pr_http_mpp',
        new BigNumber('0.01'),
        x402,
        mpp,
      );

      expect(response.headers['WWW-Authenticate']).toContain('Payment');
      expect(response.headers['WWW-Authenticate']).toContain('method="tempo"');
    });

    it('should not include WWW-Authenticate header when no MPP', () => {
      const x402 = buildX402Requirements({
        options: defaultOptions,
        resource: 'https://example.com',
        payeeName: 'Test',
      });

      const response = omniChallengeHttpResponse(
        'https://auth.atxp.ai' as any,
        'pr_no_mpp',
        new BigNumber('0.01'),
        x402,
      );

      expect(response.headers['WWW-Authenticate']).toBeUndefined();
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
      expect(challenge.x402.x402Version).toBe(2);
      expect(challenge.x402.accepts).toHaveLength(1);

      // No MPP without mppChallengeId
      expect(challenge.mpp).toBeUndefined();
    });

    it('should include MPP when mppChallengeId provided and Tempo option available', () => {
      const options = [
        ...defaultOptions,
        { network: 'tempo', currency: 'pathUSD', address: '0xTempo', amount: new BigNumber('0.01') },
      ];

      const challenge = buildOmniChallenge({
        server: 'https://auth.atxp.ai' as any,
        paymentRequestId: 'pr_with_mpp',
        chargeAmount: new BigNumber('0.10'),
        options,
        resource: 'https://example.com/resource',
        payeeName: 'MPP Test',
        mppChallengeId: 'ch_omni',
      });

      expect(challenge.mpp).toBeDefined();
      expect(challenge.mpp![0].id).toBe('ch_omni');
      expect(challenge.mpp![0].network).toBe('tempo');
    });
  });

  describe('buildPaymentOptions', () => {
    it('should return X402 requirements for base addresses and MPP challenges for solana + tempo', () => {
      const sources = [
        { chain: 'base', address: '0xBaseAddr' },
        { chain: 'solana', address: 'SolanaAddr123' },
        { chain: 'tempo', address: '0xTempoAddr' },
      ];

      const result = buildPaymentOptions({
        amount: new BigNumber('0.05'),
        sources,
        resource: 'https://example.com/api',
        payeeName: 'Test Server',
        challengeId: 'ch_test_1',
      });

      // X402: only base addresses (X402 uses Permit2, Base only)
      expect(result.x402.x402Version).toBe(2);
      expect(result.x402.accepts).toHaveLength(1);
      expect(result.x402.accepts[0].payTo).toBe('0xBaseAddr');
      expect(result.x402.accepts[0].amount).toBe('50000'); // 0.05 * 1e6

      // MPP: solana + tempo challenges
      expect(result.mpp).not.toBeNull();
      expect(result.mpp).toHaveLength(2);
      expect(result.mpp![0].method).toBe('solana');
      expect(result.mpp![0].recipient).toBe('SolanaAddr123');
      expect(result.mpp![0].id).toBe('ch_test_1');
      expect(result.mpp![1].method).toBe('tempo');
      expect(result.mpp![1].recipient).toBe('0xTempoAddr');

      // Options: all three sources converted
      expect(result.options).toHaveLength(3);
    });

    it('should return null MPP when only base sources are provided', () => {
      const sources = [
        { chain: 'base', address: '0xOnlyBase' },
      ];

      const result = buildPaymentOptions({
        amount: new BigNumber('1.00'),
        sources,
      });

      expect(result.x402.accepts).toHaveLength(1);
      expect(result.mpp).toBeNull();
    });

    it('should auto-generate challengeId when not provided', () => {
      const sources = [
        { chain: 'solana', address: 'SolAddr' },
      ];

      const result = buildPaymentOptions({
        amount: new BigNumber('0.01'),
        sources,
      });

      expect(result.mpp).not.toBeNull();
      expect(result.mpp![0].id).toMatch(/^pay-/);
    });
  });

  describe('buildAuthorizeParamsFromSources', () => {
    it('should return full X402 accepts array and MPP challenges', () => {
      const sources = [
        { chain: 'base', address: '0xBaseAddr' },
        { chain: 'solana', address: 'SolanaAddr123' },
        { chain: 'tempo', address: '0xTempoAddr' },
      ];

      const result = buildAuthorizeParamsFromSources({
        amount: new BigNumber('0.10'),
        sources,
        resource: 'https://example.com/resource',
        payeeName: 'Auth Test',
        challengeId: 'ch_auth_1',
      });

      // paymentRequirements: full {x402Version, accepts} — accounts picks chain via flag
      expect(result.paymentRequirements).toBeDefined();
      expect(result.paymentRequirements!.x402Version).toBe(2);
      expect(result.paymentRequirements!.accepts.length).toBeGreaterThan(0);
      expect(result.paymentRequirements!.accepts[0].payTo).toBe('0xBaseAddr');
      expect(result.paymentRequirements!.accepts[0].amount).toBe('100000');

      // challenges: MPP array with solana + tempo
      expect(result.challenges).toHaveLength(2);
      expect(result.challenges[0].method).toBe('solana');
      expect(result.challenges[0].id).toBe('ch_auth_1');
      expect(result.challenges[1].method).toBe('tempo');
    });

    it('should omit paymentRequirements when no X402-compatible sources exist', () => {
      const sources = [
        { chain: 'solana', address: 'SolOnly' },
      ];

      const result = buildAuthorizeParamsFromSources({
        amount: new BigNumber('0.01'),
        sources,
        challengeId: 'ch_no_x402',
      });

      expect(result.paymentRequirements).toBeUndefined();
      expect(result.challenges).toHaveLength(1);
      expect(result.challenges[0].method).toBe('solana');
    });

    it('should return empty challenges when no MPP-compatible sources exist', () => {
      const sources = [
        { chain: 'base', address: '0xBaseOnly' },
      ];

      const result = buildAuthorizeParamsFromSources({
        amount: new BigNumber('0.50'),
        sources,
      });

      expect(result.paymentRequirements).toBeDefined();
      expect(result.paymentRequirements!.x402Version).toBe(2);
      expect(result.paymentRequirements!.accepts[0].payTo).toBe('0xBaseOnly');
      expect(result.challenges).toEqual([]);
    });
  });
});
