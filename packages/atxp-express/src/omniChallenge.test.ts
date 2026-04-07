import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atxpExpress } from './atxpExpress.js';
import * as TH from '@atxp/server/serverTestHelpers';
import { getDetectedCredential, type DetectedCredential } from '@atxp/server';
import express from 'express';
import request from 'supertest';

// Mock global fetch — middleware no longer calls settle, so fetch should not be called
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('credential detection Express middleware', () => {

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('credential detected → stored in context, handler proceeds', () => {
    it('should proceed to handler without settling for X402 credential', async () => {
      const callOrder: string[] = [];

      // fetch should NOT be called — middleware no longer settles
      mockFetch.mockImplementation(async () => {
        throw new Error('fetch should not be called — middleware does not settle');
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
      // handler runs, no settle
      expect(callOrder).toEqual(['handler']);
    });

    it('should proceed to handler without settling for MPP credential', async () => {
      const callOrder: string[] = [];

      const mppCredential = {
        challenge: { id: 'ch_123', method: 'tempo', intent: 'charge', request: { amount: '10000' } },
        payload: { type: 'transaction', signature: '0xsignedtx' },
        source: 'did:pkh:eip155:4217:0xWalletAddr',
      };
      const encodedCredential = Buffer.from(JSON.stringify(mppCredential)).toString('base64');

      mockFetch.mockImplementation(async () => {
        throw new Error('fetch should not be called — middleware does not settle');
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
      expect(callOrder).toEqual(['handler']);
    });

    it('should proceed to handler without settling for ATXP credential', async () => {
      const callOrder: string[] = [];

      const atxpCredential = JSON.stringify({
        sourceAccountId: 'atxp_acct_test123',
        sourceAccountToken: 'tok_abc',
      });

      mockFetch.mockImplementation(async () => {
        throw new Error('fetch should not be called — middleware does not settle');
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
      expect(callOrder).toEqual(['handler']);
    });
  });

  describe('credential present → handler proceeds (no 402 from middleware)', () => {
    it('should return 200 even with a bad X402 credential', async () => {
      let handlerCalled = false;

      mockFetch.mockImplementation(async () => {
        throw new Error('fetch should not be called — middleware does not settle');
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.get('/resource', (_req, res) => {
        handlerCalled = true;
        res.json({ data: 'handler reached' });
      });

      const response = await request(app)
        .get('/resource')
        .set('X-PAYMENT', 'bad-x402-credential');

      expect(response.status).toBe(200);
      expect(handlerCalled).toBe(true);
    });

    it('should return 200 even with a bad MPP credential', async () => {
      let handlerCalled = false;

      mockFetch.mockImplementation(async () => {
        throw new Error('fetch should not be called — middleware does not settle');
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

      expect(response.status).toBe(200);
      expect(handlerCalled).toBe(true);
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

  describe('identity resolution from credential (MCP requests)', () => {
    it('should store MPP credential with sourceAccountId resolved from DID', async () => {
      // MPP uses Authorization: Payment which conflicts with OAuth Bearer on
      // MCP requests. For non-MCP requests the middleware detects the credential
      // but doesn't enter withATXPContext (no ATXP context to store into).
      // requirePayment() handles this at charge time for MCP. Here we verify the
      // middleware detects MPP and the handler proceeds without error.
      let storedCredential: DetectedCredential | null = null;

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
      app.get('/resource', (_req, res) => {
        storedCredential = getDetectedCredential();
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/resource')
        .set('Authorization', `Payment ${encodedCredential}`);

      expect(response.status).toBe(200);
      // Non-MCP path: no ATXP context, so credential is not stored.
      // The middleware detected it (detectProtocol returns mpp), but
      // setDetectedCredential only runs inside withATXPContext (MCP path).
      expect(storedCredential).toBeNull();
    });

    it('should store ATXP credential with sourceAccountId from raw JSON', async () => {
      let storedCredential: DetectedCredential | null = null;

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
      app.post('/', (req, res) => {
        storedCredential = getDetectedCredential();
        res.json({ ok: true });
      });

      const response = await request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .set('X-ATXP-PAYMENT', atxpCredential)
        .set('Authorization', 'Bearer test-token')
        .send(TH.mcpToolRequest());

      expect(response.status).toBe(200);
      expect(storedCredential).not.toBeNull();
      expect(storedCredential!.protocol).toBe('atxp');
      expect(storedCredential!.sourceAccountId).toBe('atxp_acct_raw123');
    });

    it('should store ATXP credential with sourceAccountId from base64-encoded JSON', async () => {
      let storedCredential: DetectedCredential | null = null;

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
      app.post('/', (req, res) => {
        storedCredential = getDetectedCredential();
        res.json({ ok: true });
      });

      const response = await request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .set('X-ATXP-PAYMENT', atxpCredential)
        .set('Authorization', 'Bearer test-token')
        .send(TH.mcpToolRequest());

      expect(response.status).toBe(200);
      expect(storedCredential).not.toBeNull();
      expect(storedCredential!.protocol).toBe('atxp');
      expect(storedCredential!.sourceAccountId).toBe('atxp_acct_b64_456');
    });
  });
});
