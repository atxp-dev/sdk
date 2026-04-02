import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atxpExpress } from './atxpExpress.js';
import * as TH from '@atxp/server/serverTestHelpers';
import express from 'express';
import request from 'supertest';

// Mock global fetch for ProtocolSettlement calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Omni-challenge Express middleware', () => {

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('X-PAYMENT credential detection and routing', () => {
    it('should detect X-PAYMENT credential and call /verify/x402 then /settle/x402', async () => {
      const verifyCall = vi.fn();
      const settleCall = vi.fn();

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/verify/x402')) {
          verifyCall();
          return { ok: true, json: async () => ({ valid: true }) };
        }
        if (urlStr.includes('/settle/x402')) {
          settleCall();
          return { ok: true, json: async () => ({ txHash: '0xabc', settledAmount: '10000' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (req, res) => {
        res.json({ data: 'protected resource' });
      });

      const response = await request(app)
        .get('/resource')
        .set('X-PAYMENT', 'x402-payment-credential');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: 'protected resource' });

      // Verify was called at request start
      expect(verifyCall).toHaveBeenCalledTimes(1);

      // Wait for settle (it happens on response finish)
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(settleCall).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid X402 credential when verify returns invalid', async () => {
      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/verify/x402')) {
          return { ok: true, json: async () => ({ valid: false }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (req, res) => {
        res.json({ data: 'should not reach' });
      });

      const response = await request(app)
        .get('/resource')
        .set('X-PAYMENT', 'invalid-x402-credential');

      expect(response.status).toBe(402);
      expect(response.body.error).toBe('invalid_payment');
    });
  });

  describe('Bearer JWT is NOT treated as ATXP payment credential', () => {
    it('should pass Bearer JWT through as normal OAuth token, not call verify/settle', async () => {
      const verifyCall = vi.fn();

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/verify/atxp')) {
          verifyCall();
          return { ok: true, json: async () => ({ valid: true }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (req, res) => {
        res.json({ data: 'protected resource' });
      });

      // Bearer JWT should be treated as OAuth token, not ATXP payment credential
      const oauthJwt = 'eyJhbGciOiJFUzI1NksifQ.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.signaturepart';

      const response = await request(app)
        .get('/resource')
        .set('Authorization', `Bearer ${oauthJwt}`);

      // Request should succeed through normal middleware path (MCP token check)
      expect(response.status).toBe(200);

      // verify/settle should NOT have been called — JWT is OAuth, not payment
      expect(verifyCall).not.toHaveBeenCalled();
    });
  });

  describe('verify at request start, settle at request end', () => {
    it('should verify before serving and settle after serving (not both upfront)', async () => {
      const callOrder: string[] = [];

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/verify/x402')) {
          callOrder.push('verify');
          return { ok: true, json: async () => ({ valid: true }) };
        }
        if (urlStr.includes('/settle/x402')) {
          callOrder.push('settle');
          return { ok: true, json: async () => ({ txHash: '0x123', settledAmount: '10000' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (req, res) => {
        // At this point, verify should have been called but not settle
        callOrder.push('serve');
        res.json({ data: 'served' });
      });

      await request(app)
        .get('/resource')
        .set('X-PAYMENT', 'x402-credential');

      // Wait for async settle callback
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify the order: verify → serve → settle
      expect(callOrder).toEqual(['verify', 'serve', 'settle']);
    });
  });

  describe('identity resolution for settlement', () => {
    it('should resolve identity from MPP credential wallet and pass to settle', async () => {
      let settleBody: Record<string, unknown> = {};
      let settleResolve: () => void;
      const settlePromise = new Promise<void>(resolve => { settleResolve = resolve; });

      mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/verify/mpp')) {
          return { ok: true, json: async () => ({ valid: true }) };
        }
        if (urlStr.includes('/settle/mpp')) {
          if (init?.body) settleBody = JSON.parse(init.body as string);
          settleResolve();
          return { ok: true, json: async () => ({ txHash: '0xmpp', settledAmount: '1.00' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const mppCredential = {
        challenge: { id: 'ch_123', method: 'tempo', intent: 'charge', request: { amount: '10000' } },
        payload: { type: 'transaction', signature: '0xsignedtx' },
        source: 'did:pkh:eip155:4217:0xWalletAddr',
      };
      const encodedCredential = Buffer.from(JSON.stringify(mppCredential)).toString('base64');

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => res.json({ ok: true }));

      const response = await request(app)
        .get('/resource')
        .set('Authorization', `Payment ${encodedCredential}`);

      expect(response.status).toBe(200);
      await settlePromise;
      expect(settleBody.sourceAccountId).toBe('tempo:0xWalletAddr');
    });

    it('should settle X402 without sourceAccountId when no OAuth token', async () => {
      let settleBody: Record<string, unknown> = {};

      mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/verify/x402')) {
          return { ok: true, json: async () => ({ valid: true }) };
        }
        if (urlStr.includes('/settle/x402')) {
          if (init?.body) settleBody = JSON.parse(init.body as string);
          return { ok: true, json: async () => ({ txHash: '0xabc', settledAmount: '10000' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => res.json({ ok: true }));

      // X402 without Bearer token — no OAuth identity available
      await request(app)
        .get('/resource')
        .set('X-PAYMENT', 'x402-payment-credential');

      await new Promise(resolve => setTimeout(resolve, 50));
      // No sourceAccountId since there's no OAuth token and X402 can't extract payer pre-settlement
      expect(settleBody.sourceAccountId).toBeUndefined();
    });
  });
});
