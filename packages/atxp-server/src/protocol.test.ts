import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectProtocol, ProtocolSettlement } from './protocol.js';

describe('detectProtocol', () => {
  it('should detect X402 from X-PAYMENT header', () => {
    const result = detectProtocol({
      'x-payment': 'some-x402-payment-credential',
    });
    expect(result).toEqual({
      protocol: 'x402',
      credential: 'some-x402-payment-credential',
    });
  });

  it('should NOT detect Bearer JWT as ATXP (could be OAuth token)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature123';
    const result = detectProtocol({
      'authorization': `Bearer ${jwt}`,
    });
    expect(result).toBeNull();
  });

  it('should detect X-PAYMENT even when Bearer token is also present', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature123';
    const result = detectProtocol({
      'x-payment': 'x402-credential',
      'authorization': `Bearer ${jwt}`,
    });
    expect(result).toEqual({
      protocol: 'x402',
      credential: 'x402-credential',
    });
  });

  it('should return null when no payment credential is present', () => {
    const result = detectProtocol({});
    expect(result).toBeNull();
  });

  it('should return null for non-Bearer authorization', () => {
    const result = detectProtocol({
      'authorization': 'Basic dXNlcjpwYXNz',
    });
    expect(result).toBeNull();
  });

  it('should return null for Bearer token that is not a JWT', () => {
    const result = detectProtocol({
      'authorization': 'Bearer simple-opaque-token',
    });
    expect(result).toBeNull();
  });
});

describe('ProtocolSettlement', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockLogger: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let settlement: ProtocolSettlement;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    settlement = new ProtocolSettlement(
      'https://auth.atxp.ai' as any,
      mockLogger,
      mockFetch,
    );
  });

  describe('verify', () => {
    it('should call /verify/x402 with payload from decoded credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      });

      // X402 credential is base64-encoded JSON payload
      const payload = { signature: '0xabc', nonce: 1 };
      const credential = Buffer.from(JSON.stringify(payload)).toString('base64');
      const result = await settlement.verify('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/verify/x402',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"payload"'),
        }),
      );
    });

    it('should call /verify/atxp with sourceAccountToken from credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      });

      const result = await settlement.verify('atxp', 'atxp-jwt-token', {
        sourceAccountId: 'atxp:acct_123',
        destinationAccountId: 'atxp:acct_456',
        options: [{ network: 'base', currency: 'USDC', address: '0x123', amount: '1000000' }],
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/verify/atxp',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"sourceAccountToken":"atxp-jwt-token"'),
        }),
      );
    });

    it('should return invalid on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
      });

      const result = await settlement.verify('x402', 'bad-credential');
      expect(result).toEqual({ valid: false });
    });
  });

  describe('settle', () => {
    it('should call /settle/x402 with decoded payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xabc', settledAmount: '100000' }),
      });

      const payload = { signature: '0xabc' };
      const credential = Buffer.from(JSON.stringify(payload)).toString('base64');
      const result = await settlement.settle('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(result).toEqual({ txHash: '0xabc', settledAmount: '100000' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/settle/x402',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"payload"'),
        }),
      );
    });

    it('should call /settle/atxp with sourceAccountToken', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xdef', settledAmount: '50000' }),
      });

      const result = await settlement.settle('atxp', 'atxp-jwt-token', {
        sourceAccountId: 'atxp:acct_123',
        destinationAccountId: 'atxp:acct_456',
        options: [{ network: 'base', currency: 'USDC', address: '0x123', amount: '1000000' }],
      });

      expect(result).toEqual({ txHash: '0xdef', settledAmount: '50000' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/settle/atxp',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"sourceAccountToken":"atxp-jwt-token"'),
        }),
      );
    });

    it('should throw on non-ok settle response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal error',
      });

      await expect(settlement.settle('x402', 'cred')).rejects.toThrow('Settlement failed for x402: 500');
    });
  });
});
