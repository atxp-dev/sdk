import { describe, it, expect } from 'vitest';
import {
  MPP_ERROR_CODE,
  parseMPPHeader,
  parseMPPFromMCPError,
  hasMPPChallenge,
  hasMPPMCPError,
} from './mppChallenge.js';

function createValidHeader(): string {
  return 'Payment method="tempo", intent="charge", id="ch_xxx", amount="1000000", currency="pathUSD", network="tempo", recipient="0xrecipient"';
}

function createValidMCPErrorBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: MPP_ERROR_CODE,
      message: 'Payment Required',
      data: {
        mpp: {
          id: 'ch_xxx',
          method: 'tempo',
          intent: 'charge',
          amount: '1000000',
          currency: 'pathUSD',
          network: 'tempo',
          recipient: '0xrecipient',
        },
      },
    },
  };
}

describe('parseMPPHeader', () => {
  it('should parse valid WWW-Authenticate header', () => {
    const result = parseMPPHeader(createValidHeader());
    expect(result).toEqual({
      id: 'ch_xxx',
      method: 'tempo',
      intent: 'charge',
      amount: '1000000',
      currency: 'pathUSD',
      network: 'tempo',
      recipient: '0xrecipient',
    });
  });

  it('should return null for header with missing fields', () => {
    const header = 'Payment method="tempo", intent="charge"';
    expect(parseMPPHeader(header)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseMPPHeader('')).toBeNull();
  });

  it('should return null for non-Payment header', () => {
    expect(parseMPPHeader('Bearer token123')).toBeNull();
  });
});

describe('parseMPPFromMCPError', () => {
  it('should parse valid MCP error data', () => {
    const data = {
      mpp: {
        id: 'ch_xxx',
        method: 'tempo',
        intent: 'charge',
        amount: '1000000',
        currency: 'pathUSD',
        network: 'tempo',
        recipient: '0xrecipient',
      },
    };
    const result = parseMPPFromMCPError(data);
    expect(result).toEqual({
      id: 'ch_xxx',
      method: 'tempo',
      intent: 'charge',
      amount: '1000000',
      currency: 'pathUSD',
      network: 'tempo',
      recipient: '0xrecipient',
    });
  });

  it('should return null when mpp field is missing', () => {
    expect(parseMPPFromMCPError({ other: 'data' })).toBeNull();
  });

  it('should return null for null input', () => {
    expect(parseMPPFromMCPError(null)).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(parseMPPFromMCPError('string')).toBeNull();
  });

  it('should return null when mpp is missing required fields', () => {
    const data = { mpp: { id: 'ch_xxx', method: 'tempo' } };
    expect(parseMPPFromMCPError(data)).toBeNull();
  });
});

describe('hasMPPChallenge', () => {
  it('should return true for response with Payment WWW-Authenticate header', () => {
    const response = new Response('', {
      status: 402,
      headers: { 'WWW-Authenticate': createValidHeader() },
    });
    expect(hasMPPChallenge(response)).toBe(true);
  });

  it('should return false for response without WWW-Authenticate header', () => {
    const response = new Response('', { status: 402 });
    expect(hasMPPChallenge(response)).toBe(false);
  });

  it('should return false for non-Payment WWW-Authenticate header', () => {
    const response = new Response('', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="example"' },
    });
    expect(hasMPPChallenge(response)).toBe(false);
  });
});

describe('hasMPPMCPError', () => {
  it('should return true for response with MCP error code -32042', async () => {
    const body = createValidMCPErrorBody();
    const response = new Response(JSON.stringify(body), { status: 200 });
    expect(await hasMPPMCPError(response)).toBe(true);
  });

  it('should return false for response with different error code', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32000,
        message: 'Some other error',
        data: {},
      },
    };
    const response = new Response(JSON.stringify(body), { status: 200 });
    expect(await hasMPPMCPError(response)).toBe(false);
  });

  it('should return false for non-JSON response', async () => {
    const response = new Response('not json', { status: 200 });
    expect(await hasMPPMCPError(response)).toBe(false);
  });

  it('should return false for empty response', async () => {
    const response = new Response('', { status: 200 });
    expect(await hasMPPMCPError(response)).toBe(false);
  });

  it('should return false when error data has no mpp field', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: MPP_ERROR_CODE,
        message: 'Payment Required',
        data: { something: 'else' },
      },
    };
    const response = new Response(JSON.stringify(body), { status: 200 });
    expect(await hasMPPMCPError(response)).toBe(false);
  });
});
