import { describe, it, expect} from 'vitest';
import { atxpServer } from './atxpServer.js';
import { MemoryOAuthDb } from '@atxp/common';
import * as TH from '@atxp/server/serverTestHelpers';
import express from 'express';
import request from 'supertest';

describe('ATXP', () => {
  it('should run code at request start and finish', async () => {
    const logger = TH.logger();
    const router = atxpServer(TH.config({
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
    const router = atxpServer(TH.config({
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
    const router = atxpServer(TH.config({
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
    // atxpServer stores the oAuth token that was used to auth to ITSELF under the url ''
    const tokenFromDb = await oAuthDb.getAccessToken('test-user', '');
    expect(tokenFromDb).toMatchObject({
      accessToken: 'self-access-token',
      resourceUrl: ''
    });
  });
  
  it('should return an OAuth challenge if token not active', async () => {
    const badToken = TH.tokenData({active: false});
    const router = atxpServer(TH.config({
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
    const router = atxpServer(TH.config({
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
    const router = atxpServer(TH.config({
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
      resource_name: 'An ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });
});