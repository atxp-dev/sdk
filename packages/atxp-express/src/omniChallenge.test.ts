import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atxpExpress } from './atxpExpress.js';
import * as TH from '@atxp/server/serverTestHelpers';
import express from 'express';
import request from 'supertest';

// Mock global fetch for ProtocolSettlement calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('settle-at-start Express middleware', () => {

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('credential detected → settle at request start', () => {
    it('should settle X402 credential before the handler runs', async () => {
      const callOrder: string[] = [];

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/x402')) {
          callOrder.push('settle');
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
      app.get('/resource', (_req, res) => {
        callOrder.push('handler');
        res.json({ data: 'protected resource' });
      });

      const response = await request(app)
        .get('/resource')
        .set('X-PAYMENT', 'x402-payment-credential');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: 'protected resource' });
      // settle happened before handler
      expect(callOrder).toEqual(['settle', 'handler']);
    });

    it('should settle MPP credential before the handler runs', async () => {
      const callOrder: string[] = [];

      const mppCredential = {
        challenge: { id: 'ch_123', method: 'tempo', intent: 'charge', request: { amount: '10000' } },
        payload: { type: 'transaction', signature: '0xsignedtx' },
        source: 'did:pkh:eip155:4217:0xWalletAddr',
      };
      const encodedCredential = Buffer.from(JSON.stringify(mppCredential)).toString('base64');

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/mpp')) {
          callOrder.push('settle');
          return { ok: true, json: async () => ({ txHash: '0xmpp', settledAmount: '10000' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => {
        callOrder.push('handler');
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/resource')
        .set('Authorization', `Payment ${encodedCredential}`);

      expect(response.status).toBe(200);
      expect(callOrder).toEqual(['settle', 'handler']);
    });

    it('should settle ATXP credential before the handler runs', async () => {
      const callOrder: string[] = [];

      const atxpCredential = JSON.stringify({
        sourceAccountId: 'atxp_acct_test123',
        sourceAccountToken: 'tok_abc',
      });

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/atxp')) {
          callOrder.push('settle');
          return { ok: true, json: async () => ({ txHash: 'atxp_tx', settledAmount: '5000' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => {
        callOrder.push('handler');
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/resource')
        .set('X-ATXP-PAYMENT', atxpCredential);

      expect(response.status).toBe(200);
      expect(callOrder).toEqual(['settle', 'handler']);
    });
  });

  describe('settlement failure → 402 and handler does not run', () => {
    it('should return 402 when X402 settlement fails', async () => {
      let handlerCalled = false;

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/x402')) {
          return { ok: false, status: 400, text: async () => 'Settlement failed' };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => {
        handlerCalled = true;
        res.json({ data: 'should not reach' });
      });

      const response = await request(app)
        .get('/resource')
        .set('X-PAYMENT', 'bad-x402-credential');

      expect(response.status).toBe(402);
      expect(response.body.error).toBe('settlement_failed');
      expect(handlerCalled).toBe(false);
    });

    it('should return 402 when MPP settlement fails', async () => {
      let handlerCalled = false;

      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/mpp')) {
          return { ok: false, status: 400, text: async () => 'MPP settlement failed' };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => {
        handlerCalled = true;
        res.json({ ok: true });
      });

      const mppCredential = Buffer.from(JSON.stringify({ payload: {} })).toString('base64');

      const response = await request(app)
        .get('/resource')
        .set('Authorization', `Payment ${mppCredential}`);

      expect(response.status).toBe(402);
      expect(response.body.error).toBe('settlement_failed');
      expect(handlerCalled).toBe(false);
    });
  });

  describe('no credential → normal flow continues', () => {
    it('should pass through to handler when no payment credential is present', async () => {
      // No fetch calls expected for settle
      mockFetch.mockImplementation(async () => {
        throw new Error('fetch should not be called');
      });

      const router = atxpExpress(TH.config({
        destination: 'test-destination',
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => {
        res.json({ data: 'public resource' });
      });

      const response = await request(app)
        .get('/resource');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: 'public resource' });
    });

    it('should treat Bearer JWT as OAuth token, not payment credential', async () => {
      // fetch should not be called for settle — Bearer is OAuth, not a payment protocol
      let settleCalled = false;
      mockFetch.mockImplementation(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/')) {
          settleCalled = true;
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => {
        res.json({ data: 'protected resource' });
      });

      const oauthJwt = 'eyJhbGciOiJFUzI1NksifQ.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.signaturepart';

      const response = await request(app)
        .get('/resource')
        .set('Authorization', `Bearer ${oauthJwt}`);

      expect(response.status).toBe(200);
      expect(settleCalled).toBe(false);
    });
  });

  describe('identity resolution for settlement', () => {
    it('should resolve identity from MPP credential and pass sourceAccountId to settle', async () => {
      let settleBody: Record<string, unknown> = {};

      mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/mpp')) {
          if (init?.body) settleBody = JSON.parse(init.body as string);
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
      expect(settleBody.sourceAccountId).toBe('tempo:0xWalletAddr');
    });

    it('should resolve identity from ATXP raw JSON credential', async () => {
      let settleBody: Record<string, unknown> = {};

      mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/atxp')) {
          if (init?.body) settleBody = JSON.parse(init.body as string);
          return { ok: true, json: async () => ({ txHash: 'atxp_tx', settledAmount: '5000' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      // Raw JSON (not base64-encoded)
      const atxpCredential = JSON.stringify({
        sourceAccountId: 'atxp_acct_raw123',
        sourceAccountToken: 'tok_raw',
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => res.json({ ok: true }));

      const response = await request(app)
        .get('/resource')
        .set('X-ATXP-PAYMENT', atxpCredential);

      expect(response.status).toBe(200);
      expect(settleBody.sourceAccountId).toBe('atxp_acct_raw123');
    });

    it('should resolve identity from ATXP base64-encoded credential', async () => {
      let settleBody: Record<string, unknown> = {};

      mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/settle/atxp')) {
          if (init?.body) settleBody = JSON.parse(init.body as string);
          return { ok: true, json: async () => ({ txHash: 'atxp_tx', settledAmount: '5000' }) };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      // Base64-encoded JSON
      const atxpCredential = Buffer.from(JSON.stringify({
        sourceAccountId: 'atxp_acct_b64_456',
        sourceAccountToken: 'tok_b64',
      })).toString('base64');

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => res.json({ ok: true }));

      const response = await request(app)
        .get('/resource')
        .set('X-ATXP-PAYMENT', atxpCredential);

      expect(response.status).toBe(200);
      expect(settleBody.sourceAccountId).toBe('atxp_acct_b64_456');
    });
  });
});
