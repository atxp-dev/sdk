import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  it('should detect X402 from payment-signature header (v2)', () => {
    const result = detectProtocol({
      'payment-signature': 'v2-payment-signature-credential',
    });
    expect(result).toEqual({
      protocol: 'x402',
      credential: 'v2-payment-signature-credential',
    });
  });

  it('should prefer payment-signature over x-payment when both present', () => {
    const result = detectProtocol({
      'payment-signature': 'v2-credential',
      'x-payment': 'v1-credential',
    });
    expect(result).toEqual({
      protocol: 'x402',
      credential: 'v2-credential',
    });
  });

  it('should return null when no payment credential is present', () => {
    const result = detectProtocol({});
    expect(result).toBeNull();
  });

  it('should detect MPP from Authorization: Payment header', () => {
    const result = detectProtocol({
      'authorization': 'Payment eyJjaGFsbGVuZ2UiOiJjaF8xMjMifQ==',
    });
    expect(result).toEqual({
      protocol: 'mpp',
      credential: 'eyJjaGFsbGVuZ2UiOiJjaF8xMjMifQ==',
    });
  });

  it('should prefer X-PAYMENT (X402) over Authorization: Payment (MPP)', () => {
    const result = detectProtocol({
      'x-payment': 'x402-credential',
      'authorization': 'Payment mpp-credential',
    });
    expect(result).toEqual({
      protocol: 'x402',
      credential: 'x402-credential',
    });
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

    it('should call /verify/mpp with standard MPP credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      });

      const mppCredential = {
        challenge: { id: 'ch_456', method: 'tempo', intent: 'charge', request: { amount: '25000' } },
        payload: { type: 'hash', hash: '0xabc' },
        source: 'did:pkh:eip155:4217:0xSrc',
      };
      const credential = Buffer.from(JSON.stringify(mppCredential)).toString('base64');
      const result = await settlement.verify('mpp', credential);

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.atxp.ai/verify/mpp',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.credential).toEqual(mppCredential);
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

    it('should call /settle/mpp with standard MPP credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xmpp', settledAmount: '10000' }),
      });

      const mppCredential = {
        challenge: { id: 'ch_123', method: 'tempo', intent: 'charge', request: { amount: '10000' } },
        payload: { type: 'transaction', signature: '0xsignedtx' },
        source: 'did:pkh:eip155:4217:0xSrc',
      };
      const credential = Buffer.from(JSON.stringify(mppCredential)).toString('base64');
      const result = await settlement.settle('mpp', credential);

      expect(result).toEqual({ txHash: '0xmpp', settledAmount: '10000' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.credential).toEqual(mppCredential);
      expect(body.amount).toBeUndefined();
    });

    it('should include sourceAccountId in MPP settle when context provides it', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xid', settledAmount: '10000' }),
      });

      const mppCredential = {
        challenge: { id: 'ch_id', method: 'tempo', intent: 'charge', request: { amount: '10000' } },
        payload: { type: 'transaction', signature: '0xsigned' },
        source: 'did:pkh:eip155:4217:0xSrc',
      };
      const credential = Buffer.from(JSON.stringify(mppCredential)).toString('base64');
      await settlement.settle('mpp', credential, { sourceAccountId: 'tempo:0xTestUser' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sourceAccountId).toBe('tempo:0xTestUser');
    });

    it('should include sourceAccountId in X402 settle when context provides it', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xid', settledAmount: '10000' }),
      });

      const payload = { signature: '0xabc' };
      const credential = Buffer.from(JSON.stringify(payload)).toString('base64');
      await settlement.settle('x402', credential, {
        paymentRequirements: { network: 'base' },
        sourceAccountId: 'base:0xTestUser',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sourceAccountId).toBe('base:0xTestUser');
    });

    it('should handle raw JSON MPP credential (not base64)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xraw', settledAmount: '5000' }),
      });

      const mppCredential = {
        challenge: { id: 'ch_789', method: 'tempo', intent: 'charge', request: { amount: '5000' } },
        payload: { type: 'hash', hash: '0xabc' },
        source: 'did:pkh:eip155:4217:0xSrc',
      };
      const result = await settlement.settle('mpp', JSON.stringify(mppCredential));

      expect(result).toEqual({ txHash: '0xraw', settledAmount: '5000' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.credential).toEqual(mppCredential);
      expect(body.amount).toBeUndefined();
    });

    it('should throw on non-ok settle response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal error',
      });

      await expect(settlement.settle('x402', 'cred')).rejects.toThrow('Settlement failed for x402: 500');
    });

    it('should pass through null txHash when auth reports already-settled', async () => {
      // The auth server returns { txHash: null, alreadySettled: true, ... } on
      // retries of an already-settled payload. The SDK should surface it as-is
      // rather than crashing or forcing the type to string.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          txHash: null,
          settledAmount: '201000',
          alreadySettled: true,
          network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          payer: '3FnrCCfHhZhEyeQd5Q69B1faqLvdHoG3WxUesZBBJ7M2',
          sourceAccountId: 'atxp:atxp_acct_6qB245zVIJeSiIHi8xPmY',
        }),
      });

      const payload = { signature: '0xabc' };
      const credential = Buffer.from(JSON.stringify(payload)).toString('base64');
      const result = await settlement.settle('x402', credential, { paymentRequirements: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' } });

      expect(result.txHash).toBeNull();
      expect(result.settledAmount).toBe('201000');
      expect(result.alreadySettled).toBe(true);
    });

    describe('X402 multi-chain accept routing', () => {
      const multiChainReqs = {
        x402Version: 2,
        accepts: [
          { network: 'eip155:8453', payTo: '0xBase', amount: '10000', scheme: 'exact' },
          { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: 'SolDest', amount: '10000', scheme: 'exact' },
        ],
      };

      beforeEach(() => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ txHash: '0x123', settledAmount: '10000' }),
        });
      });

      it('should select Solana accept when credential has solana accepted.network', async () => {
        const solanaPayload = {
          payload: { transaction: 'base64tx' },
          accepted: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
        };
        const credential = Buffer.from(JSON.stringify(solanaPayload)).toString('base64');

        await settlement.settle('x402', credential, { paymentRequirements: multiChainReqs });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.paymentRequirements.network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
        expect(body.paymentRequirements.payTo).toBe('SolDest');
      });

      it('should select EVM accept when credential has no accepted field', async () => {
        const evmPayload = { signature: '0xabc' };
        const credential = Buffer.from(JSON.stringify(evmPayload)).toString('base64');

        await settlement.settle('x402', credential, { paymentRequirements: multiChainReqs });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.paymentRequirements.network).toBe('eip155:8453');
      });

      it('should warn when credential network not found in accepts', async () => {
        const unknownPayload = {
          accepted: { network: 'eip155:999999' },
        };
        const credential = Buffer.from(JSON.stringify(unknownPayload)).toString('base64');

        await settlement.settle('x402', credential, { paymentRequirements: multiChainReqs });

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('credential network eip155:999999 not in accepts'),
        );
      });

      it('should warn when no EVM accept exists for EVM fallback', async () => {
        const solanaOnlyReqs = {
          x402Version: 2,
          accepts: [
            { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: 'SolDest', amount: '10000', scheme: 'exact' },
          ],
        };
        const evmPayload = { signature: '0xabc' };
        const credential = Buffer.from(JSON.stringify(evmPayload)).toString('base64');

        await settlement.settle('x402', credential, { paymentRequirements: solanaOnlyReqs });

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('no EVM accept found'),
        );
      });
    });
  });

  describe('X-ATXP-APP-NAME header', () => {
    // Auth reads this header and attaches it to settle observability events
    // so dashboards can slice by calling service. See auth#254.
    const savedAppName = process.env.APP_NAME;
    afterEach(() => {
      if (savedAppName === undefined) delete process.env.APP_NAME;
      else process.env.APP_NAME = savedAppName;
    });

    const okResponse = () => ({ ok: true, json: async () => ({ txHash: '0xabc', settledAmount: '1' }) });
    const credential = Buffer.from(JSON.stringify({ signature: '0xabc' })).toString('base64');

    const headersFromFetch = (fetch: ReturnType<typeof vi.fn>) =>
      fetch.mock.calls[0][1].headers as Record<string, string>;

    it('sends X-ATXP-App-Name when the explicit appName option is set', async () => {
      mockFetch.mockResolvedValue(okResponse());
      const s = new ProtocolSettlement(
        'https://auth.atxp.ai' as any,
        mockLogger,
        mockFetch,
        undefined,
        { appName: 'llm' },
      );

      await s.settle('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(headersFromFetch(mockFetch)['X-ATXP-APP-NAME']).toBe('llm');
    });

    it('falls back to process.env.APP_NAME when appName option is omitted', async () => {
      process.env.APP_NAME = 'music-mcp';
      mockFetch.mockResolvedValue(okResponse());
      const s = new ProtocolSettlement(
        'https://auth.atxp.ai' as any,
        mockLogger,
        mockFetch,
      );

      await s.settle('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(headersFromFetch(mockFetch)['X-ATXP-APP-NAME']).toBe('music-mcp');
    });

    it('explicit appName option overrides process.env.APP_NAME', async () => {
      process.env.APP_NAME = 'from-env';
      mockFetch.mockResolvedValue(okResponse());
      const s = new ProtocolSettlement(
        'https://auth.atxp.ai' as any,
        mockLogger,
        mockFetch,
        undefined,
        { appName: 'from-option' },
      );

      await s.settle('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(headersFromFetch(mockFetch)['X-ATXP-APP-NAME']).toBe('from-option');
    });

    it('explicit empty string disables env fallback (header omitted)', async () => {
      // Empty-string override lets tests and oddball configs opt out of the
      // env fallback without mutating process.env.
      process.env.APP_NAME = 'would-have-used-this';
      mockFetch.mockResolvedValue(okResponse());
      const s = new ProtocolSettlement(
        'https://auth.atxp.ai' as any,
        mockLogger,
        mockFetch,
        undefined,
        { appName: '' },
      );

      await s.settle('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(headersFromFetch(mockFetch)).not.toHaveProperty('X-ATXP-APP-NAME');
    });

    it('omits the header when neither option nor env is set', async () => {
      delete process.env.APP_NAME;
      mockFetch.mockResolvedValue(okResponse());
      const s = new ProtocolSettlement(
        'https://auth.atxp.ai' as any,
        mockLogger,
        mockFetch,
      );

      await s.settle('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(headersFromFetch(mockFetch)).not.toHaveProperty('X-ATXP-APP-NAME');
    });

    it('trims whitespace-only values to undefined (header omitted)', async () => {
      mockFetch.mockResolvedValue(okResponse());
      const s = new ProtocolSettlement(
        'https://auth.atxp.ai' as any,
        mockLogger,
        mockFetch,
        undefined,
        { appName: '   ' },
      );

      await s.settle('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(headersFromFetch(mockFetch)).not.toHaveProperty('X-ATXP-APP-NAME');
    });

    it('sets the header on verify() as well as settle()', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true }) });
      const s = new ProtocolSettlement(
        'https://auth.atxp.ai' as any,
        mockLogger,
        mockFetch,
        undefined,
        { appName: 'llm' },
      );

      await s.verify('x402', credential, { paymentRequirements: { network: 'base' } });

      expect(headersFromFetch(mockFetch)['X-ATXP-APP-NAME']).toBe('llm');
    });
  });
});
