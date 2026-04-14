import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { PendingPaymentChallenge } from '@atxp/server';
import { installPaymentResponseRewriter } from './atxpExpress.js';

// Mock getPendingPaymentChallenge from @atxp/server.
// installPaymentResponseRewriter calls it inside rewriteChunk to decide
// whether to rewrite. We control it per-test via mockChallenge.
let mockChallenge: PendingPaymentChallenge | null = null;
vi.mock('@atxp/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atxp/server')>();
  return {
    ...actual,
    getPendingPaymentChallenge: () => mockChallenge,
  };
});

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

// --- Fixtures ---

const challenge: PendingPaymentChallenge = {
  code: -30402,
  message: 'Payment via ATXP is required. Please pay at: https://auth.example.com/payment-request/pr_123 and then try again.',
  data: {
    paymentRequestId: 'pr_123',
    paymentRequestUrl: 'https://auth.example.com/payment-request/pr_123',
    chargeAmount: '0.01',
    x402: { x402Version: 2, accepts: [{ scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', amount: '10000' }] },
    mpp: [{ id: 'pr_123', method: 'tempo', intent: 'charge', amount: '0.01', currency: 'USDC', network: 'tempo', recipient: '0xDest' }],
  },
};

/** The wrapped tool error that McpServer produces (small body). */
const wrappedToolError = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: {
    isError: true,
    content: [{ type: 'text', text: 'MCP error -30402: Payment via ATXP is required. Please pay at: https://auth.example.com/payment-request/pr_123 and then try again.' }],
  },
});

/** The rewritten JSON-RPC error (larger body with full challenge data). */
const rewrittenError = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  error: {
    code: challenge.code,
    message: challenge.message,
    data: challenge.data,
  },
});

/** A normal (non-payment) MCP response body. */
const normalResponse = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: { content: [{ type: 'text', text: 'Hello world' }] },
});

// --- Mock Response ---

/** Creates a mock Express Response with spied writeHead/write/end. */
function createMockRes() {
  const written: { method: string; args: any[] }[] = [];

  const res: any = {
    writeHead: vi.fn(function (this: any, ...args: any[]) {
      written.push({ method: 'writeHead', args });
      return this;
    }),
    write: vi.fn(function (this: any, ...args: any[]) {
      written.push({ method: 'write', args });
      return true;
    }),
    end: vi.fn(function (this: any, ...args: any[]) {
      written.push({ method: 'end', args });
    }),
  };

  return { res: res as Response, written };
}

/**
 * Simulate @hono/node-server's responseViaCache JSON path:
 *   header["Content-Length"] = Buffer.byteLength(body);
 *   outgoing.writeHead(status, header);
 *   outgoing.end(body);
 */
function simulateHonoJsonResponse(res: Response, body: string) {
  const headers: Record<string, any> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  (res as any).writeHead(200, headers);
  (res as any).end(body);
}

/**
 * Simulate @hono/node-server's streaming (SSE) path:
 *   outgoing.writeHead(res.status, resHeaderRecord);
 *   values.forEach(value => outgoing.write(value));
 *   outgoing.end();
 */
function simulateHonoSSEResponse(res: Response, chunks: string[]) {
  const headers: Record<string, any> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  };
  (res as any).writeHead(200, headers);
  for (const chunk of chunks) {
    (res as any).write(chunk);
  }
  (res as any).end();
}

// --- Tests ---

beforeEach(() => {
  mockChallenge = null;
  vi.clearAllMocks();
});

describe('installPaymentResponseRewriter — JSON (non-SSE) path', () => {
  it('updates Content-Length when body is rewritten to a larger payload', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    simulateHonoJsonResponse(res, wrappedToolError);

    // writeHead should have been called with the REWRITTEN body's length
    const whCall = written.find(c => c.method === 'writeHead')!;
    expect(whCall).toBeDefined();
    const sentHeaders = whCall.args[1];
    expect(sentHeaders['Content-Length']).toBe(Buffer.byteLength(rewrittenError));

    // end should have been called with the rewritten body
    const endCall = written.find(c => c.method === 'end')!;
    expect(endCall).toBeDefined();
    const sentBody = endCall.args[0];
    expect(JSON.parse(sentBody)).toEqual(JSON.parse(rewrittenError));
  });

  it('preserves original Content-Length when no challenge is pending', () => {
    mockChallenge = null;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    simulateHonoJsonResponse(res, normalResponse);

    const whCall = written.find(c => c.method === 'writeHead')!;
    expect(whCall.args[1]['Content-Length']).toBe(Buffer.byteLength(normalResponse));

    const endCall = written.find(c => c.method === 'end')!;
    expect(endCall.args[0]).toBe(normalResponse);
  });

  it('preserves original Content-Length when body does not match challenge', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    // This body has a challenge pending but the body text doesn't contain the
    // payment URL, so tryRewritePaymentResponse returns null → no rewrite.
    simulateHonoJsonResponse(res, normalResponse);

    const whCall = written.find(c => c.method === 'writeHead')!;
    expect(whCall.args[1]['Content-Length']).toBe(Buffer.byteLength(normalResponse));

    const endCall = written.find(c => c.method === 'end')!;
    expect(endCall.args[0]).toBe(normalResponse);
  });

  it('handles writeHead(statusCode, statusMessage, headers) three-arg form', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    // Some frameworks call writeHead(200, 'OK', headers)
    const headers: Record<string, any> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(wrappedToolError),
    };
    (res as any).writeHead(200, 'OK', headers);
    (res as any).end(wrappedToolError);

    const whCall = written.find(c => c.method === 'writeHead')!;
    // headers are at index 2 (after statusCode and statusMessage)
    expect(whCall.args[2]['Content-Length']).toBe(Buffer.byteLength(rewrittenError));
  });

  it('works when end is called without writeHead (implicit headers)', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    // No writeHead call — Express sometimes sends headers implicitly
    (res as any).end(wrappedToolError);

    // writeHead should NOT appear in the calls
    expect(written.filter(c => c.method === 'writeHead')).toHaveLength(0);

    // Body should still be rewritten
    const endCall = written.find(c => c.method === 'end')!;
    expect(JSON.parse(endCall.args[0])).toEqual(JSON.parse(rewrittenError));
  });

  it('restores original writeHead/write/end after end is called', () => {
    mockChallenge = null;
    const { res } = createMockRes();
    const origEnd = res.end;
    const origWrite = res.write;
    const origWriteHead = res.writeHead;
    installPaymentResponseRewriter(res, logger);

    // Hooks are installed — methods differ
    expect(res.end).not.toBe(origEnd);
    expect(res.write).not.toBe(origWrite);
    expect(res.writeHead).not.toBe(origWriteHead);

    // After end(), originals should be restored
    (res as any).writeHead(200, {});
    (res as any).end('');

    expect(res.end).toBe(origEnd);
    expect(res.write).toBe(origWrite);
    expect(res.writeHead).toBe(origWriteHead);
  });

  it('handles Buffer body and updates Content-Length correctly', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    const bufBody = Buffer.from(wrappedToolError, 'utf-8');
    const headers: Record<string, any> = {
      'Content-Type': 'application/json',
      'Content-Length': bufBody.length,
    };
    (res as any).writeHead(200, headers);
    (res as any).end(bufBody);

    const whCall = written.find(c => c.method === 'writeHead')!;
    expect(whCall.args[1]['Content-Length']).toBe(Buffer.byteLength(rewrittenError));
  });
});

describe('installPaymentResponseRewriter — SSE path', () => {
  it('flushes deferred writeHead on first write call', () => {
    mockChallenge = null;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    const sseHeaders = { 'Content-Type': 'text/event-stream' };
    (res as any).writeHead(200, sseHeaders);

    // writeHead is deferred — not yet flushed
    expect(written.filter(c => c.method === 'writeHead')).toHaveLength(0);

    // First write flushes it
    (res as any).write('data: {}\n\n');
    expect(written.filter(c => c.method === 'writeHead')).toHaveLength(1);
    expect(written[0].args[1]).toBe(sseHeaders);

    // Second write does NOT call writeHead again
    (res as any).write('data: {}\n\n');
    expect(written.filter(c => c.method === 'writeHead')).toHaveLength(1);
  });

  it('rewrites payment error chunks in SSE data lines', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    const sseChunk = `data: ${wrappedToolError}\n\n`;
    simulateHonoSSEResponse(res, [sseChunk]);

    const writeCall = written.find(c => c.method === 'write')!;
    expect(writeCall).toBeDefined();
    const rewrittenChunk = writeCall.args[0] as string;
    expect(rewrittenChunk).toMatch(/^data: /);
    const json = JSON.parse(rewrittenChunk.replace(/^data: /, '').trim());
    expect(json.error.code).toBe(-30402);
    expect(json.error.data).toEqual(challenge.data);
    expect(json.result).toBeUndefined();
  });

  it('passes through non-payment SSE chunks unchanged', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    const normalChunk = `data: ${normalResponse}\n\n`;
    simulateHonoSSEResponse(res, [normalChunk]);

    const writeCall = written.find(c => c.method === 'write')!;
    expect(writeCall.args[0]).toBe(normalChunk);
  });

  it('rewrites only payment error chunk in a multi-chunk SSE stream', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    const normalChunk = `data: ${normalResponse}\n\n`;
    const errorChunk = `data: ${wrappedToolError}\n\n`;
    simulateHonoSSEResponse(res, [normalChunk, errorChunk]);

    const writeCalls = written.filter(c => c.method === 'write');
    expect(writeCalls).toHaveLength(2);

    // First chunk: unchanged
    expect(writeCalls[0].args[0]).toBe(normalChunk);

    // Second chunk: rewritten
    const rewritten = writeCalls[1].args[0] as string;
    expect(rewritten).toMatch(/^data: /);
    const json = JSON.parse(rewritten.replace(/^data: /, '').trim());
    expect(json.error.code).toBe(-30402);
    expect(json.error.data.mpp).toBeDefined();
  });
});

describe('installPaymentResponseRewriter — Content-Length correctness', () => {
  it('rewritten Content-Length matches actual body byte length', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    simulateHonoJsonResponse(res, wrappedToolError);

    const whCall = written.find(c => c.method === 'writeHead')!;
    const endCall = written.find(c => c.method === 'end')!;

    const claimedLength = whCall.args[1]['Content-Length'] as number;
    const actualLength = Buffer.byteLength(endCall.args[0] as string);
    expect(claimedLength).toBe(actualLength);
  });

  it('original Content-Length matches body when no rewrite occurs', () => {
    mockChallenge = null;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    simulateHonoJsonResponse(res, normalResponse);

    const whCall = written.find(c => c.method === 'writeHead')!;
    const endCall = written.find(c => c.method === 'end')!;

    const claimedLength = whCall.args[1]['Content-Length'] as number;
    const actualLength = Buffer.byteLength(endCall.args[0] as string);
    expect(claimedLength).toBe(actualLength);
  });

  it('writeHead and end are called in correct order for JSON path', () => {
    mockChallenge = challenge;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    simulateHonoJsonResponse(res, wrappedToolError);

    const methods = written.map(c => c.method);
    expect(methods).toEqual(['writeHead', 'end']);
  });

  it('writeHead is called before first write for SSE path', () => {
    mockChallenge = null;
    const { res, written } = createMockRes();
    installPaymentResponseRewriter(res, logger);

    simulateHonoSSEResponse(res, ['data: {}\n\n', 'data: {}\n\n']);

    const methods = written.map(c => c.method);
    expect(methods).toEqual(['writeHead', 'write', 'write', 'end']);
  });
});
