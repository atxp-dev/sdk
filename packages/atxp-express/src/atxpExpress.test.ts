import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { atxpExpress } from './atxpExpress.js';
import { MemoryOAuthDb } from '@atxp/common';
import { requirePayment } from '@atxp/server';
import * as TH from '@atxp/server/serverTestHelpers';
import { BigNumber } from 'bignumber.js';
import express from 'express';
import request from 'supertest';

describe('ATXP', () => {
  it('should run code at request start and finish', async () => {
    const logger = TH.logger();
    const router = atxpExpress(TH.config({
      logger, 
      oAuthClient: TH.oAuthClient({introspectResult: TH.tokenData({active: true})})
    }));

    const app = express();
    app.use(express.json());
    app.use(router);
    
    // Add a test endpoint
    app.post('/', (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer test-access-token')
      .send(TH.mcpToolRequest());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
    expect(logger.debug).toHaveBeenCalledWith('Request started - POST /');
    expect(logger.debug).toHaveBeenCalledWith('Request finished for user test-user - POST /');
  });

  it('should run code at start and finish if sending an OAuth challenge', async () => {
    const badToken = TH.tokenData({active: false});
    const logger = TH.logger();
    const router = atxpExpress(TH.config({
      logger, 
      oAuthClient: TH.oAuthClient({introspectResult: badToken})
    }));

    const app = express();
    app.use(express.json());
    app.use(router);
    
    // Add a test endpoint
    app.post('/', (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer test-access-token')
      .send(TH.mcpToolRequest());

    expect(response.status).toBe(401);
    expect(logger.debug).toHaveBeenCalledWith('Request started - POST /');
    expect(logger.debug).toHaveBeenCalledWith('Request finished - POST /');
  });

  it('should save the oAuth token in the DB if it is active', async () => {
    const goodToken = TH.tokenData({active: true, sub: 'test-user'});
    const oAuthDb = new MemoryOAuthDb();
    const router = atxpExpress(TH.config({
      oAuthClient: TH.oAuthClient({introspectResult: goodToken}),
      oAuthDb
    }));

    const app = express();
    app.use(express.json());
    app.use(router);
    
    // Add a test endpoint
    app.post('/', (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer self-access-token')
      .send(TH.mcpToolRequest());

    expect(response.status).toBe(200);
    // atxpExpress stores the oAuth token that was used to auth to ITSELF under the url ''
    const tokenFromDb = await oAuthDb.getAccessToken('test-user', '');
    expect(tokenFromDb).toMatchObject({
      accessToken: 'self-access-token',
      resourceUrl: ''
    });
  });
  
  it('should return an OAuth challenge if token not active', async () => {
    const badToken = TH.tokenData({active: false});
    const router = atxpExpress(TH.config({
      oAuthClient: TH.oAuthClient({introspectResult: badToken})
    }));

    const app = express();
    app.use(express.json());
    app.use(router);
    
    // Add a test endpoint
    app.post('/', (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer test-access-token')
      .send(TH.mcpToolRequest());

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toMatch(/Bearer resource_metadata="https?:\/\/127\.0\.0\.1:\d+\/.well-known\/oauth-protected-resource\/"/)
  });

  it('should not intercept non-MCP requests', async () => {
    const router = atxpExpress(TH.config({
      destination: 'test-destination',
    }));

    const app = express();
    app.use(express.json());
    app.use(router);
    
    // Add a test endpoint
    app.get('/non-mcp', (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .get('/non-mcp');

    // The middleware should allow the request to pass through to the endpoint
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
  });

  it('serves PRM endpoint', async () => {
    const router = atxpExpress(TH.config({
      destination: 'test-destination',
    }));

    const app = express();
    app.use(express.json());
    app.use(router);

    const response = await request(app)
      .get('/.well-known/oauth-protected-resource');

    expect(response.status).toBe(200);
    // Check the response data
    expect(response.body).toMatchObject({
      resource: expect.stringMatching(/^https?:\/\/127\.0\.0\.1:\d+\/$/),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  // The forwarding is one line at atxpExpress.ts (new ProtocolSettlement(...,
  // { appName: config.appName })), but it's the glue most likely to silently
  // break if someone refactors the settlement instantiation — a missing
  // passthrough would still compile and pass unit tests. Close the loop by
  // asserting the header actually reaches the outgoing fetch.
  describe('X-ATXP-APP-NAME header forwarding', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      mockFetch.mockReset();
      // Default: swallow the settle call so the middleware moves on to the
      // handler. Tests assert on the headers recorded here.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xabc', settledAmount: '100' }),
        text: async () => '',
      });
      // vi.stubGlobal + unstubAllGlobals is the idiomatic vitest pattern; plain
      // reassignment of globalThis.fetch doesn't always propagate through the
      // `fetch.bind(globalThis)` used in atxpExpress under all vitest configs.
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const atxpCredential = JSON.stringify({
      sourceAccountId: 'atxp_acct_test123',
      sourceAccountToken: 'tok_abc',
    });

    const findSettleCall = () => mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/settle/'),
    );

    // The middleware only runs the settle path on MCP requests — non-MCP
    // requests bail out at parseMcpRequestsNode, which is why the older
    // omniChallenge.test.ts tests observe that fetch isn't called.
    const sendMcpToolCall = (app: express.Application) =>
      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer test-access-token')
        .set('X-ATXP-PAYMENT', atxpCredential)
        .send(TH.mcpToolRequest());

    it('forwards config.appName into the X-ATXP-APP-NAME header on /settle/*', async () => {
      const router = atxpExpress(TH.config({
        appName: 'music-mcp',
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      // requirePayment charges the implicit session; settlement fires at close.
      app.post('/', async (_req, res) => {
        await requirePayment({ price: BigNumber(0.01) });
        res.json({ ok: true });
      });

      await sendMcpToolCall(app).expect(200);

      const settleCall = findSettleCall();
      expect(settleCall, 'atxpExpress should have called /settle/*').toBeDefined();
      const headers = settleCall![1].headers as Record<string, string>;
      expect(headers['X-ATXP-APP-NAME']).toBe('music-mcp');
    });

    it('omits the header when config.appName is unset and APP_NAME env is empty', async () => {
      const savedAppName = process.env.APP_NAME;
      delete process.env.APP_NAME;
      try {
        const router = atxpExpress(TH.config({
          oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
        }));

        const app = express();
        app.use(express.json());
        app.use(router);
        app.post('/', async (_req, res) => {
          await requirePayment({ price: BigNumber(0.01) });
          res.json({ ok: true });
        });

        await sendMcpToolCall(app).expect(200);

        const settleCall = findSettleCall();
        expect(settleCall, 'atxpExpress should have called /settle/*').toBeDefined();
        const headers = settleCall![1].headers as Record<string, string>;
        expect(headers).not.toHaveProperty('X-ATXP-APP-NAME');
      } finally {
        if (savedAppName === undefined) delete process.env.APP_NAME;
        else process.env.APP_NAME = savedAppName;
      }
    });
  });

  // Phase 1: settlement moved off the inbound request and onto session close.
  describe('settlement happens once at session close (not inbound)', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xabc', settledAmount: '0.01' }),
        text: async () => '',
      });
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const atxpCredential = JSON.stringify({
      sourceAccountId: 'atxp_acct_test123',
      sourceAccountToken: 'tok_abc',
    });

    const settleCalls = () => mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/settle/'),
    );

    const sendPaidMcpCall = (app: express.Application) =>
      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer test-access-token')
        .set('X-ATXP-PAYMENT', atxpCredential)
        .send(TH.mcpToolRequest());

    it('settles exactly once, AFTER the route ran, for a single paid tool call', async () => {
      const order: string[] = [];
      mockFetch.mockImplementation(async (url: string | URL) => {
        if (String(url).includes('/settle/')) order.push('settle');
        return { ok: true, json: async () => ({ txHash: '0xabc', settledAmount: '0.01' }), text: async () => '' };
      });

      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.post('/', async (_req, res) => {
        order.push('route');
        await requirePayment({ price: BigNumber(0.01) });
        res.json({ ok: true });
      });

      await sendPaidMcpCall(app).expect(200);

      expect(settleCalls()).toHaveLength(1);
      // Settle is deferred until response close, so it runs after the route.
      expect(order).toEqual(['route', 'settle']);
    });

    it('does NOT settle when the route never calls requirePayment (nothing charged)', async () => {
      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.post('/', (_req, res) => res.json({ ok: true }));

      await sendPaidMcpCall(app).expect(200);

      expect(settleCalls()).toHaveLength(0);
    });

    it('settles once even when the route calls requirePayment multiple times', async () => {
      const router = atxpExpress(TH.config({
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.post('/', async (_req, res) => {
        await requirePayment({ price: BigNumber(0.01) });
        await requirePayment({ price: BigNumber(0.01) });
        res.json({ ok: true });
      });

      await sendPaidMcpCall(app).expect(200);

      expect(settleCalls()).toHaveLength(1);
    });
  });

  // FIX 3: Phase 1 has no retry/outbox. A close-time settle failure must NOT
  // fail the already-served request — the route still returns 200 — and the
  // failure must be logged with a greppable, metric-able marker.
  describe('settle failure at close: route still returns 200 and logs a marker', () => {
    const mockFetch = vi.fn();

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const atxpCredential = JSON.stringify({
      sourceAccountId: 'atxp_acct_test123',
      sourceAccountToken: 'tok_abc',
    });

    const sendPaidMcpCall = (app: express.Application) =>
      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer test-access-token')
        .set('X-ATXP-PAYMENT', atxpCredential)
        .send(TH.mcpToolRequest());

    it('returns 200 and logs settle_failed_at_close when /settle/* rejects', async () => {
      // Auth /settle/* returns a non-OK status → ProtocolSettlement.settle throws.
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'settle exploded',
      });
      vi.stubGlobal('fetch', mockFetch);

      const logger = TH.logger();
      const router = atxpExpress(TH.config({
        logger,
        oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
      }));

      const app = express();
      app.use(express.json());
      app.use(router);
      app.post('/', async (_req, res) => {
        await requirePayment({ price: BigNumber(0.01) });
        res.json({ ok: true });
      });

      // The served request still succeeds despite the settle failure.
      const response = await sendPaidMcpCall(app).expect(200);
      expect(response.body).toMatchObject({ ok: true });

      // The failure is logged with the actionable marker (protocol + amount).
      const errorLog = (logger.error as any).mock.calls.map((c: any[]) => String(c[0])).join('\n');
      expect(errorLog).toContain('settle_failed_at_close');
      expect(errorLog).toContain('protocol=atxp');
      expect(errorLog).toContain('amount=0.01');
    });
  });
});