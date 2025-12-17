import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import { DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';
import { atxpClient } from './atxpClient.js';
import * as CTH from '@atxp/common/src/commonTestHelpers.js';
import BigNumber from 'bignumber.js';

describe('atxpClient events', () => {
  it('should call onAuthorize when authorizing', async () => {
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

    const onAuthorize = vi.fn();
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
      onAuthorize,
      fetchFn: f.fetchHandler
    });

    const res = await client.callTool({ name: 'authorize', arguments: {} });
    expect(res).toMatchObject({content: [{type: 'text', text: 'hello world'}]});
    expect(onAuthorize).toHaveBeenCalledWith({
      authorizationServer: DEFAULT_AUTHORIZATION_SERVER,
      userId: 'bdj'
    });
  });

  it('should call onAuthorizeFailure when authorizing fails', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', CTH.authRequiredResponse())
      .post('https://example.com/mcp', CTH.mcpResponseHandler(CTH.mcpToolResponse(1, 'hello world')));
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      // Respond to /authorize call with an error
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&error=access_denied&error_description=User+denied+access`}
        };
      });

    const onAuthorizeFailure = vi.fn();
    const paymentMaker = {
      makePayment: vi.fn(),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const account = {
      getAccountId: vi.fn().mockResolvedValue('bdj'),
      paymentMakers: [paymentMaker],
      getSources: vi.fn().mockResolvedValue([])
    };

    // The client initialization or callTool will throw an error due to OAuth failure
    await expect(async () => {
      const client = await atxpClient({
        mcpServer: 'https://example.com/mcp',
        account,
        onAuthorizeFailure,
        fetchFn: f.fetchHandler
      });
      await client.callTool({ name: 'authorize', arguments: {} });
    }).rejects.toThrow('authorization response from the server is an error');

    // The callback should have been called before the error was thrown
    expect(onAuthorizeFailure).toHaveBeenCalledTimes(1);
    expect(onAuthorizeFailure).toHaveBeenCalledWith({
      authorizationServer: DEFAULT_AUTHORIZATION_SERVER,
      userId: 'bdj',
      error: expect.any(Error)
    });
  });

  it('should call onPayment when making a payment', async () => {
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

    const onPayment = vi.fn();
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
      onPayment,
      fetchFn: f.fetchHandler
    });

    const res = await client.callTool({ name: 'pay', arguments: {} });
    expect(res).toMatchObject({content: [{type: 'text', text: 'hello world'}]});
    expect(paymentMaker.makePayment).toHaveBeenCalled();
    expect(onPayment).toHaveBeenCalledWith({
      payment: expect.objectContaining({
        accountId: 'bdj',
        amount: BigNumber(0.01),
        currency: 'USDC'
      }),
      network: 'solana',
      transactionHash: 'test-payment-result-id'
    });
  });
  
  it('should call onPaymentFailure when making a payment fails', async () => {
    const f = fetchMock.createInstance();
    const paymentRequestId = 'test-payment-id';
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, paymentRequestId);
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      // First two calls are initialization (initialize and notifications/initialized)
      .postOnce('https://example.com/mcp', CTH.mcpResponseHandler())
      .postOnce('https://example.com/mcp', CTH.mcpResponseHandler())
      // Third call (callTool) returns payment required
      .postOnce('https://example.com/mcp', errMsg)
      // Fallback for any additional calls
      .post('https://example.com/mcp', CTH.mcpResponseHandler(CTH.mcpToolResponse(1, 'hello world')));
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {[paymentRequestId]: new BigNumber(0.01)});

    const onPaymentFailure = vi.fn();
    const paymentMaker = {
      makePayment: vi.fn().mockImplementation(() => Promise.reject(new Error('Payment failed'))),
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
      onPaymentFailure,
      fetchFn: f.fetchHandler
    });

    // The payment will fail and throw an error
    await expect(client.callTool({ name: 'pay', arguments: {} })).rejects.toThrow('Payment failed');

    // Verify the callbacks were called
    expect(paymentMaker.makePayment).toHaveBeenCalledTimes(1);
    expect(onPaymentFailure).toHaveBeenCalledTimes(1);
    expect(onPaymentFailure).toHaveBeenCalledWith({
      payment: expect.objectContaining({
        accountId: 'bdj',
        amount: new BigNumber(0.01),
        currency: expect.any(String)
      }),
      error: expect.any(Error),
      attemptedNetworks: expect.any(Array),
      failureReasons: expect.any(Map),
      retryable: expect.any(Boolean),
      timestamp: expect.any(Date)
    });
  });
});
