import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import { DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';
import { atxpClient } from './atxpClient.js';
import * as CTH from '@atxp/common/src/commonTestHelpers.js';
import BigNumber from 'bignumber.js';

describe('atxpClient', () => {
  it('should call authorize if server returns oAuth challenge', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', CTH.authRequiredResponse())
      .post('https://example.com/mcp', CTH.mcpResponseHandler(CTH.mcpToolResponse(1, 'hello world')));
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      // Respond to /authorize call
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn(),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const account = {
      getAccountId: vi.fn().mockResolvedValue('bdj'),
      paymentMakers: [paymentMaker],
      getSources: vi.fn().mockResolvedValue([])
    };
    const client = await atxpClient({
      mcpServer: 'https://example.com/mcp',
      account,
      fetchFn: f.fetchHandler
    });

    const res = await client.callTool({ name: 'authorize', arguments: {} });
    expect(res).toMatchObject({content: [{type: 'text', text: 'hello world'}]});
    const authCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`);
    expect(authCall).toBeDefined();
    const authHeader = (authCall!.args[1] as any).headers['Authorization'];
    expect(authHeader).toBeDefined();
    expect(authHeader).toContain('Bearer ');
  });

  it('should make payment if server returns payment required', async () => {
    const f = fetchMock.createInstance();
    const paymentRequestId = 'test-payment-id';
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, paymentRequestId);
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .post('https://example.com/mcp', CTH.mcpResponseHandler(CTH.mcpToolResponse(1, 'hello world')));
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {[paymentRequestId]: new BigNumber(0.01)})
      .putOnce(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`, {
        payment_id: 'test-payment-result-id'
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'test-payment-result-id', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const account = {
      getAccountId: vi.fn().mockResolvedValue('bdj'),
      paymentMakers: [paymentMaker],
      getSources: vi.fn().mockResolvedValue([])
    };
    const client = await atxpClient({
      mcpServer: 'https://example.com/mcp',
      account,
      fetchFn: f.fetchHandler
    });

    const res = await client.callTool({ name: 'pay', arguments: {} });
    expect(res).toMatchObject({content: [{type: 'text', text: 'hello world'}]});
    expect(paymentMaker.makePayment).toHaveBeenCalled();
    const putCall = f.callHistory.lastCall(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`);
    expect(putCall).toBeDefined();
    const headers = (putCall!.args[1] as any).headers;
    const authHeader = headers instanceof Headers ? headers.get('Authorization') : headers['Authorization'];
    expect(authHeader).toBeDefined();
    expect(authHeader).toContain('Bearer ');
  });
  
  it('should authorize and make payment in the same call if server responds with oauth and payment required in subsequent calls', async () => {
    const f = fetchMock.createInstance();
    const paymentRequestId = 'test-payment-id';
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, paymentRequestId);
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      // First call returns OAuth challenge
      .postOnce('https://example.com/mcp', CTH.authRequiredResponse())
      // Next call completes initialize/notification via handler
      .postOnce('https://example.com/mcp', CTH.mcpResponseHandler())
      // First tool call returns payment required
      .postOnce('https://example.com/mcp', errMsg)
      // Fallback for any additional calls, including retry after payment
      .post('https://example.com/mcp', CTH.mcpResponseHandler(CTH.mcpToolResponse(1, 'hello world')));
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {[paymentRequestId]: new BigNumber(0.01)})
      // Respond to /authorize call
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'test-payment-result-id', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const account = {
      getAccountId: vi.fn().mockResolvedValue('bdj'),
      paymentMakers: [paymentMaker],
      getSources: vi.fn().mockResolvedValue([])
    };
    const client = await atxpClient({
      mcpServer: 'https://example.com/mcp',
      account,
      fetchFn: f.fetchHandler
    });

    const res = await client.callTool({ name: 'pay', arguments: {} });
    expect(res).toMatchObject({content: [{type: 'text', text: 'hello world'}]});
    const authCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`);
    expect(authCall).toBeDefined();
    const putCall = f.callHistory.lastCall(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`);
    expect(putCall).toBeDefined();
  });
});
