import { describe, it, expect, vi } from 'vitest';
import { tryRewritePaymentResponse, rewriteSingleResponse } from './atxpExpress.js';
import type { PendingPaymentChallenge } from '@atxp/server';

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

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

describe('rewriteSingleResponse', () => {
  it('should rewrite a wrapped payment tool error into a JSON-RPC error', () => {
    const wrapped = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'MCP error -30402: Payment via ATXP is required. Please pay at: https://auth.example.com/payment-request/pr_123 and then try again.' }],
      },
    };

    const result = rewriteSingleResponse(wrapped, challenge);
    expect(result).not.toBeNull();
    expect(result!.jsonrpc).toBe('2.0');
    expect(result!.id).toBe(1);
    expect(result!.error).toBeDefined();
    expect((result!.error as any).code).toBe(-30402);
    expect((result!.error as any).data).toEqual(challenge.data);
    // Must not have a result field (it's an error now)
    expect(result!.result).toBeUndefined();
  });

  it('should return null for a non-error tool result', () => {
    const normal = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    };
    expect(rewriteSingleResponse(normal, challenge)).toBeNull();
  });

  it('should return null for an error tool result that does not match the challenge', () => {
    const otherError = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'Some other error that is not a payment challenge' }],
      },
    };
    expect(rewriteSingleResponse(otherError, challenge)).toBeNull();
  });

  it('should return null for a JSON-RPC error (already an error, not a wrapped result)', () => {
    const alreadyError = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid Request' },
    };
    expect(rewriteSingleResponse(alreadyError, challenge)).toBeNull();
  });

  it('should return null for non-objects', () => {
    expect(rewriteSingleResponse(null, challenge)).toBeNull();
    expect(rewriteSingleResponse('string', challenge)).toBeNull();
    expect(rewriteSingleResponse(42, challenge)).toBeNull();
  });

  it('should return null if challenge has no paymentRequestUrl', () => {
    const noUrl: PendingPaymentChallenge = { code: -30402, message: 'test', data: {} };
    const wrapped = {
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text', text: 'test' }] },
    };
    expect(rewriteSingleResponse(wrapped, noUrl)).toBeNull();
  });
});

describe('tryRewritePaymentResponse', () => {
  it('should rewrite a single JSON-RPC response body', () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'MCP error -30402: Payment via ATXP is required. Please pay at: https://auth.example.com/payment-request/pr_123 and then try again.' }],
      },
    });

    const result = tryRewritePaymentResponse(body, challenge, logger);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.error.code).toBe(-30402);
    expect(parsed.error.data.x402).toBeDefined();
    expect(parsed.error.data.mpp).toBeDefined();
    expect(parsed.result).toBeUndefined();
  });

  it('should rewrite matching item in a batch response', () => {
    const body = JSON.stringify([
      { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } },
      {
        jsonrpc: '2.0',
        id: 2,
        result: {
          isError: true,
          content: [{ type: 'text', text: 'MCP error -30402: Payment via ATXP is required. Please pay at: https://auth.example.com/payment-request/pr_123 and then try again.' }],
        },
      },
    ]);

    const result = tryRewritePaymentResponse(body, challenge, logger);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed).toHaveLength(2);
    // First item unchanged
    expect(parsed[0].result.content[0].text).toBe('ok');
    // Second item rewritten
    expect(parsed[1].error.code).toBe(-30402);
    expect(parsed[1].error.data.x402).toBeDefined();
  });

  it('should return null for non-JSON body', () => {
    expect(tryRewritePaymentResponse('not json', challenge, logger)).toBeNull();
  });

  it('should return null for a normal (non-payment) response', () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'Hello' }] },
    });
    expect(tryRewritePaymentResponse(body, challenge, logger)).toBeNull();
  });

  it('should return null for an empty string', () => {
    expect(tryRewritePaymentResponse('', challenge, logger)).toBeNull();
  });
});
