import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BigNumber } from 'bignumber.js';
import { atxpExpress } from './atxpExpress.js';
import { requirePayment } from '@atxp/server';
import * as TH from '@atxp/server/serverTestHelpers';

/**
 * Integration test for FIX 2: settlement at response close must fire through a
 * REAL McpServer + StreamableHTTPServerTransport (modeled on src/dev/resource.ts),
 * not just a synchronous express route handler. The transport's res.end happens
 * inside its own async machinery; this proves the captured-closure settle runs
 * regardless of where res.end is invoked from.
 */

// A self-contained ATXP credential (X-ATXP-PAYMENT header → atxp protocol).
const atxpCredential = JSON.stringify({
  sourceAccountId: 'atxp_acct_test123',
  sourceAccountToken: 'tok_abc',
});

function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'test-mcp-server', version: '1.0.0' },
    { capabilities: { logging: {} } },
  );

  server.registerTool(
    'paid-tool',
    {
      description: 'A tool that requires payment.',
      inputSchema: { message: z.string().optional() },
    },
    async ({ message }: { message?: string }): Promise<CallToolResult> => {
      await requirePayment({ price: BigNumber(0.01) });
      return { content: [{ type: 'text', text: `paid: ${message ?? 'ok'}` }] };
    },
  );

  return server;
}

function buildApp(): express.Application {
  const router = atxpExpress(TH.config({
    oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
  }));

  const app = express();
  app.use(express.json());
  app.use(router);

  // Stateless streamable HTTP transport per request, exactly as resource.ts does.
  app.post('/', async (req: Request, res: Response) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

const sendPaidToolCall = (app: express.Application) =>
  request(app)
    .post('/')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .set('Authorization', 'Bearer test-access-token')
    .set('X-ATXP-PAYMENT', atxpCredential)
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'paid-tool', arguments: { message: 'hi' } },
    });

describe('settlement fires through a real McpServer + StreamableHTTPServerTransport', () => {
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

  const settleCalls = () => mockFetch.mock.calls.filter(
    ([url]) => typeof url === 'string' && url.includes('/settle/'),
  );

  it('calls /settle/* exactly once when a paid tool runs through the transport', async () => {
    const app = buildApp();

    const response = await sendPaidToolCall(app);

    expect(response.status).toBe(200);
    // The tool result is delivered through the transport.
    const body = JSON.stringify(response.body);
    expect(body).toContain('paid: hi');

    // Settlement fired at response close — through the real transport's res.end,
    // not a synchronous express route.
    expect(settleCalls()).toHaveLength(1);
    expect(String(settleCalls()[0][0])).toContain('/settle/atxp');
  });

  it('settles the summed actual ($0.003) — not the cap ($0.01) — when a tool charges 3x $0.001', async () => {
    // ATXP credential carrying options with the authorized cap ($0.01). The
    // express path falls back to the credential's options for the settle body,
    // and deriveCap reads options[].amount → cap $0.01.
    const meteredCredential = JSON.stringify({
      sourceAccountId: 'atxp_acct_test123',
      sourceAccountToken: 'tok_abc',
      options: [{ network: 'base', currency: 'USDC', address: '0xdest', amount: '0.01' }],
    });

    const router = atxpExpress(TH.config({
      oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
    }));
    const app = express();
    app.use(express.json());
    app.use(router);
    app.post('/', async (req: Request, res: Response) => {
      const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: { logging: {} } });
      server.registerTool(
        'metered-tool',
        { description: 'meters 3x $0.001', inputSchema: { message: z.string().optional() } },
        async (): Promise<CallToolResult> => {
          // 3 charges of $0.001 each → summed actual $0.003 < cap $0.01.
          await requirePayment({ price: BigNumber(0.001) });
          await requirePayment({ price: BigNumber(0.001) });
          await requirePayment({ price: BigNumber(0.001) });
          return { content: [{ type: 'text', text: 'metered' }] };
        },
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Authorization', 'Bearer test-access-token')
      .set('X-ATXP-PAYMENT', meteredCredential)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'metered-tool', arguments: {} } });

    expect(response.status).toBe(200);

    // Exactly one settle, to /settle/atxp.
    expect(settleCalls()).toHaveLength(1);
    expect(String(settleCalls()[0][0])).toContain('/settle/atxp');

    // The settled amount is the SUMMED ACTUAL ($0.003), not the cap ($0.01).
    const settleBody = JSON.parse((settleCalls()[0][1] as { body: string }).body);
    expect(settleBody.options).toHaveLength(1);
    expect(settleBody.options[0].amount).toBe('0.003');
  });

  it('does NOT settle through the transport when the tool charges nothing', async () => {
    const router = atxpExpress(TH.config({
      oAuthClient: TH.oAuthClient({ introspectResult: TH.tokenData({ active: true, sub: 'test-user' }) }),
    }));
    const app = express();
    app.use(express.json());
    app.use(router);
    app.post('/', async (req: Request, res: Response) => {
      const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: { logging: {} } });
      server.registerTool(
        'free-tool',
        { description: 'free', inputSchema: { message: z.string().optional() } },
        async (): Promise<CallToolResult> => ({ content: [{ type: 'text', text: 'free' }] }),
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Authorization', 'Bearer test-access-token')
      .set('X-ATXP-PAYMENT', atxpCredential)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'free-tool', arguments: {} } });

    expect(response.status).toBe(200);
    expect(settleCalls()).toHaveLength(0);
  });
});
