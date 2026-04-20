import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { atxpExpress } from './atxpExpress.js';
import { MemoryOAuthDb } from '@atxp/common';
import * as TH from '@atxp/server/serverTestHelpers';
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
      app.post('/', (_req, res) => res.json({ ok: true }));

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
        app.post('/', (_req, res) => res.json({ ok: true }));

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
});