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

  it('should detect ATXP-MCP from Bearer JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature123';
    const result = detectProtocol({
      'authorization': `Bearer ${jwt}`,
    });
    expect(result).toEqual({
      protocol: 'atxp',
      credential: jwt,
    });
  });

  it('should prefer X-PAYMENT over Bearer token when both present', () => {
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
    it('should call /verify/x402 for X402 credentials', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      });

      const result = await settlement.verify('x402', 'x402-credential');

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/verify/x402',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"credential":"x402-credential"'),
        }),
      );
    });

    it('should call /verify/atxp for ATXP credentials', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      });

      const result = await settlement.verify('atxp', 'atxp-jwt-token');

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/verify/atxp',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"credential":"atxp-jwt-token"'),
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
    it('should call /settle/x402 for X402 credentials', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xabc', settledAmount: '100000' }),
      });

      const result = await settlement.settle('x402', 'x402-credential', '0.01');

      expect(result).toEqual({ txHash: '0xabc', settledAmount: '100000' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/settle/x402',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"credential":"x402-credential"'),
        }),
      );
    });

    it('should call /settle/atxp for ATXP credentials', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xdef', settledAmount: '50000' }),
      });

      const result = await settlement.settle('atxp', 'atxp-jwt-token');

      expect(result).toEqual({ txHash: '0xdef', settledAmount: '50000' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/settle/atxp',
        expect.objectContaining({
          method: 'POST',
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
