import { MemoryOAuthDb } from '@atxp/common';
import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import * as CTH from '@atxp/common/src/commonTestHelpers.js';
import { ATXPFetcher } from './atxpFetcher.js';
import { OAuthDb, FetchLike, AuthorizationServerUrl, DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';
import { PaymentMaker, ProspectivePayment } from './types.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import BigNumber from 'bignumber.js';

function mockPaymentMakers(solanaPaymentMaker?: PaymentMaker) {
  solanaPaymentMaker = solanaPaymentMaker ?? {
    makePayment: vi.fn().mockResolvedValue('testPaymentId'),
    generateJWT: vi.fn().mockResolvedValue('testJWT')
  };
  return new Map([['solana' as any, solanaPaymentMaker]]);
}

function atxpFetcher(
  fetchFn: FetchLike,
  paymentMakers?: Map<any, PaymentMaker>,
  db?: OAuthDb,
  allowedAuthorizationServers?: AuthorizationServerUrl[],
  approvePayment?: (payment: ProspectivePayment) => Promise<boolean>
) {
  return new ATXPFetcher({
    accountId: "bdj",
    db: db ?? new MemoryOAuthDb(),
    paymentMakers: paymentMakers ?? mockPaymentMakers(),
    destinationMakers: new Map(),
    fetchFn,
    allowedAuthorizationServers,
    approvePayment
  });
}

describe('atxpFetcher.fetch payment', () => {
  it('should make a payment if the server response is a atxp payment request error', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(0.01)});

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]));
    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    // Ensure we make a payment 
    expect(paymentMaker.makePayment).toHaveBeenCalled();
    // Ensure we call the payment request endpoint
    const payCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`);
    expect(payCall).toBeDefined();
    // Ensure there was an auth header with the payment id and signature
    const authHeader = (payCall!.args[1] as any).headers['Authorization'];
    expect(authHeader).toBeDefined();
    expect(authHeader).toContain('Bearer ');
    const jwtToken = authHeader.split(' ')[1];
    expect(jwtToken).toBe('testJWT');
  });

  it('should make a payment if the server response is an elicitation request error', async () => {
    const f = fetchMock.createInstance();
    const errMsg = CTH.mcpElicitationRequiredErrorResponse({url: `${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`, elicitationId: 'foo'});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(0.01)});

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]));
    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    // Ensure we make a payment 
    expect(paymentMaker.makePayment).toHaveBeenCalled();
    // Ensure we call the payment request endpoint
    const payCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`);
    expect(payCall).toBeDefined();
    // Ensure there was an auth header with the payment id and signature
    const authHeader = (payCall!.args[1] as any).headers['Authorization'];
    expect(authHeader).toBeDefined();
    expect(authHeader).toContain('Bearer ');
    const jwtToken = authHeader.split(' ')[1];
    expect(jwtToken).toBe('testJWT');
  });

  it('should pass through an elicitation request error that is not atxp', async () => {
    const f = fetchMock.createInstance();
    const errMsg = CTH.mcpElicitationRequiredErrorResponse({url: `https://slack.com/give-me-api-key`, elicitationId: 'foo'});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(0.01)});

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]));
    const res = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const resJson = await res.json();
    expect(resJson).toMatchObject(errMsg);
  });

  it('should allow consuming the body of the response', async () => {
    const f = fetchMock.createInstance();
    const responseJson = {content: [{type: 'text', text: 'hello world'}]};

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', responseJson);
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER);

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]));
    const res = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(await res.json()).toEqual(responseJson);
  });

  it('should retry the request if a payment was required and made successfully', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(0.01)});

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]));
    const res = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    const resJson = await res.json();
    expect(resJson).toMatchObject({content: [{type: 'text', text: 'hello world'}]});
    const mcpCalls = f.callHistory.callLogs.filter(call => call.url.startsWith('https://example.com/mcp'));
    expect(mcpCalls.length).toBe(2);
    expect(mcpCalls[0].args[0]).toBe('https://example.com/mcp');
    expect(mcpCalls[1].args[0]).toBe('https://example.com/mcp');
  });

  it('should pass through a payment request response if there is no matching payment maker', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(0.01)});

    const fetcher = atxpFetcher(f.fetchHandler, new Map());
    const res = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    const resJson = await res.json();
    expect(resJson.result.content[0].type).toBe('text');
    expect(resJson.result.content[0].text).to.include('Payment via ATXP is required');
    expect(resJson.result.content[0].text).to.include(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`);
  });

  it('should throw an error if the server does not have the payment request', async() => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {})
      .getOnce(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`, 404);
    let threw = false;

    const fetcher = atxpFetcher(f.fetchHandler, new Map());
    try {
      await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch (e: any) {
      threw = true;
      expect(e).not.toBeInstanceOf(McpError);
    }
    expect(threw).toBe(true);
  });

  it('should pass through payment request response if the payment request server is not allowed', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(0.01)});

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, {'solana': paymentMaker}, undefined, ['https://not-atxp.com']);
    const res = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    expect(res.status).toBe(200);
    const resJson = await res.json();
    expect(resJson.result.content[0].type).toBe('text');
    expect(resJson.result.content[0].text).to.include('Payment via ATXP is required');
    expect(resJson.result.content[0].text).to.include(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`);
  });

  it('should not make a payment if the payment request is denied by the callback function', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(0.01)});

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]), undefined, undefined, async () => false);
    const res = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    expect(res.status).toBe(200);
    const resJson = await res.json();
    expect(resJson.result.content[0].type).toBe('text');
    expect(resJson.result.content[0].text).to.include('Payment via ATXP is required');
    expect(resJson.result.content[0].text).to.include(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`);
  });

  it('should throw an error if amount is negative', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {'foo': BigNumber(-0.01)});
    let threw = false;

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]));
    try {
      await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch (e: any) {
      threw = true;
      expect(e).not.toBeInstanceOf(McpError);
    }
    expect(threw).toBe(true);
  });

  it('should throw an error if PUTing to the payment-request endpoint fails', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {})
      .putOnce(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`, 500);
    let threw = false;

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue('testPaymentId'),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, new Map([['solana' as any, paymentMaker]]));
    try {
      await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch (e: any) {
      threw = true;
      expect(e).not.toBeInstanceOf(McpError);
    }
    expect(threw).toBe(true);
  });
});
