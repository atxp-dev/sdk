import { MemoryOAuthDb, Account } from '@atxp/common';
import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import * as CTH from '@atxp/common/src/commonTestHelpers.js';
import { ATXPFetcher } from './atxpFetcher.js';
import { OAuthDb, FetchLike, AuthorizationServerUrl, DEFAULT_AUTHORIZATION_SERVER, AccessToken } from '@atxp/common';
import { PaymentMaker, ProspectivePayment } from './types.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import BigNumber from 'bignumber.js';
import { PassthroughDestinationMaker } from './destinationMakers/passthroughDestinationMaker.js';

function mockPaymentMakers(solanaPaymentMaker?: PaymentMaker) {
  solanaPaymentMaker = solanaPaymentMaker ?? {
    makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
    generateJWT: vi.fn().mockResolvedValue('testJWT'),
    getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
  };
  return [solanaPaymentMaker];
}

function atxpFetcher(
  fetchFn: FetchLike,
  paymentMakers?: PaymentMaker[],
  db?: OAuthDb,
  allowedAuthorizationServers?: AuthorizationServerUrl[],
  approvePayment?: (payment: ProspectivePayment) => Promise<boolean>
) {
  const destinationMakers = new Map();
  destinationMakers.set('solana', new PassthroughDestinationMaker('solana'));

  const account: Account = {
    getAccountId: async () => "bdj" as any,
    paymentMakers: paymentMakers ?? mockPaymentMakers(),
    usesAccountsAuthorize: false,
    getSources: async () => [{
      address: 'SolAddress123',
      chain: 'solana' as any,
      walletType: 'eoa' as any
    }],
    createSpendPermission: async () => null
  };

  return new ATXPFetcher({
    account,
    db: db ?? new MemoryOAuthDb(),
    destinationMakers,
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
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

    const fetcher = atxpFetcher(f.fetchHandler, []);
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

    const fetcher = atxpFetcher(f.fetchHandler, []);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, ['https://not-atxp.com']);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, undefined, async () => false);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
    try {
      await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch (e: any) {
      threw = true;
      expect(e).not.toBeInstanceOf(McpError);
    }
    expect(threw).toBe(true);
  });

  it('should use iss field as memo when present in payment request', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'foo');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});

    // Mock payment request with both iss and payeeName
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {});
    f.getOnce(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`, {
      options: [{
        amount: '0.01',
        currency: 'USDC',
        network: 'solana',
        address: 'testDestination'
      }],
      sourceAccountId: 'solana:testSource',
      destinationAccountId: 'solana:testDestination',
      resource: new URL('https://example.com/resource'),
      payeeName: 'Image',
      iss: 'auth.atxp.ai'
    });
    f.putOnce(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/foo`, 200);

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Verify makePayment was called with iss as memo, not payeeName
    expect(paymentMaker.makePayment).toHaveBeenCalledWith(
      expect.anything(), // destinations
      'auth.atxp.ai',    // memo should be iss value
      'foo'              // paymentRequestId
    );
  });

  it('should fall back to payeeName as memo when iss is not present in payment request', async () => {
    const f = fetchMock.createInstance();
    const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, 'bar');
    const errMsg = CTH.mcpToolErrorResponse({content: [{type: 'text', text: errTxt}]});

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', errMsg)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});

    // Mock payment request with only payeeName (no iss field)
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {});
    f.getOnce(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/bar`, {
      options: [{
        amount: '0.01',
        currency: 'USDC',
        network: 'solana',
        address: 'testDestination'
      }],
      sourceAccountId: 'solana:testSource',
      destinationAccountId: 'solana:testDestination',
      resource: new URL('https://example.com/resource'),
      payeeName: 'LegacyService'
      // Note: no iss field
    });
    f.putOnce(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/bar`, 200);

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana', currency: 'USDC' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Verify makePayment was called with payeeName as memo (backward compatibility)
    expect(paymentMaker.makePayment).toHaveBeenCalledWith(
      expect.anything(),  // destinations
      'LegacyService',    // memo should be payeeName when iss not present
      'bar'               // paymentRequestId
    );
  });
});

describe('atxpFetcher protocol handler retry uses OAuth-authenticated fetch', () => {
  it('should include OAuth Bearer token on ATXPAccountHandler retry requests', async () => {
    // This test verifies the fix: getProtocolConfig().fetchFn wraps oauthClient.fetch
    // (not raw fetch), so retries from protocol handlers include the Authorization: Bearer header.
    //
    // Flow:
    // 1. ATXPFetcher.fetch() → oauthClient.fetch() → resource server returns 402
    // 2. tryProtocolHandlers() → ATXPAccountHandler.handlePaymentChallenge()
    // 3. account.authorize() returns credential
    // 4. ATXPAccountHandler retries via config.fetchFn(url, retryInit) → oauthClient.fetch()
    // 5. oauthClient._doFetch adds Authorization: Bearer from stored token
    // 6. Retry request has BOTH X-ATXP-PAYMENT and Authorization: Bearer headers

    const f = fetchMock.createInstance();
    const resourceUrl = 'https://example.com/mcp';

    // Mock the resource server PRM and auth server (needed for OAuthClient initialization)
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER);
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER);

    // First POST: resource server returns 402 with challenge data
    f.postOnce(resourceUrl, {
      status: 402,
      body: {
        chargeAmount: '0.01',
        paymentRequestUrl: `${DEFAULT_AUTHORIZATION_SERVER}/payment-request/pr_test`,
        paymentRequestId: 'pr_test',
      },
    });
    // Second POST: retry after payment authorization succeeds
    f.postOnce(resourceUrl, {
      status: 200,
      body: { content: [{ type: 'text', text: 'paid content' }] },
    });

    // Create account with usesAccountsAuthorize: true → uses ATXPAccountHandler
    const authorize = vi.fn().mockResolvedValue({
      protocol: 'atxp',
      credential: 'test-payment-credential',
    });
    const account: Account = {
      getAccountId: async () => 'test-user' as any,
      paymentMakers: [],
      usesAccountsAuthorize: true,
      getSources: async () => [],
      createSpendPermission: async () => null,
      authorize,
    };

    // Pre-seed the OAuth DB with an access token so oauthClient._doFetch adds
    // the Authorization: Bearer header on requests to the resource URL.
    const db = new MemoryOAuthDb();
    const storedToken: AccessToken = {
      accessToken: 'oauth-bearer-token-123',
      resourceUrl: 'https://example.com/mcp',
      expiresAt: Date.now() + 60_000,
    };
    await db.saveAccessToken('test-user', 'https://example.com/mcp', storedToken);

    const fetcher = new ATXPFetcher({
      account,
      db,
      destinationMakers: new Map(),
      fetchFn: f.fetchHandler,
    });

    const res = await fetcher.fetch(resourceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);

    // Verify authorize was called
    expect(authorize).toHaveBeenCalledTimes(1);

    // Get all calls to the resource URL
    const mcpCalls = f.callHistory.callLogs.filter(
      call => call.url === resourceUrl,
    );
    expect(mcpCalls.length).toBe(2);

    const retryCall = mcpCalls[1];
    // fetch-mock stores headers in args[1].headers (the init object passed to fetch)
    const retryInit = retryCall.args[1] as RequestInit | undefined;
    const retryHeaders = new Headers(retryInit?.headers);

    // The retry must include the payment credential header
    expect(retryHeaders.get('X-ATXP-PAYMENT')).toBe('test-payment-credential');

    // CRITICAL: The retry must ALSO include the OAuth Bearer token.
    // This is the bug that was fixed — previously getProtocolConfig().fetchFn used raw fetch
    // instead of oauthClient.fetch, so the Bearer token was missing on retries.
    expect(retryHeaders.get('Authorization')).toBe('Bearer oauth-bearer-token-123');
  });
});
