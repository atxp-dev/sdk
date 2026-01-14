import { MemoryOAuthDb, Account } from '@atxp/common';
import { OAuthAuthenticationRequiredError } from './oAuth.js';
import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import { ATXPFetcher } from './atxpFetcher.js';
import { OAuthDb, FetchLike, DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';
import { PaymentMaker } from './types.js';

function mockPaymentMakers(solanaPaymentMaker?: PaymentMaker) {
  solanaPaymentMaker = solanaPaymentMaker ?? {
    makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
    generateJWT: vi.fn().mockResolvedValue('testJWT'),
    getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
  };
  return [solanaPaymentMaker];
}

function atxpFetcher(fetchFn: FetchLike, paymentMakers?: PaymentMaker[], db?: OAuthDb) {
  const account: Account = {
    getAccountId: async () => "bdj" as any,
    paymentMakers: paymentMakers ?? mockPaymentMakers(),
    getSources: async () => [{
      address: 'SolAddress123',
      chain: 'solana' as any,
      walletType: 'eoa' as any
    }]
  };

  return new ATXPFetcher({
    account,
    db: db ?? new MemoryOAuthDb(),
    destinationMakers: new Map(),
    fetchFn
  });
}

describe('atxpFetcher.fetch oauth', () => {
  it('should auth using the payment maker if one is available', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: (params: {paymentIds?: string[], codeChallenge?: string}) => Promise.resolve(JSON.stringify(params)),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Ensure we call the authorize endpoint
    const authCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`);
    expect(authCall).toBeDefined();
    // Ensure there was an auth header with the payment id and signature
    const authHeader = (authCall!.args[1] as any).headers['Authorization'];
    expect(authHeader).toBeDefined();
    expect(authHeader).toContain('Bearer ');
    // We hacked up the JWT to be a JSON.stringify'd version of the params passed to generateJWT
    // above. Here, we're going to check that that's what was submitted to the AS /authorize
    const jwtToken = JSON.parse(authHeader.split(' ')[1]);
    expect(jwtToken.codeChallenge).toBeDefined();
    expect(jwtToken.codeChallenge.length).toBeGreaterThan(10);
  });

  it('should throw an error if multiple payment makers are available (we dont know how to handle this yet)', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
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
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: (params: {paymentIds?: string[], codeChallenge?: string}) => Promise.resolve(JSON.stringify(params)),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker, paymentMaker]); // Two payment makers to trigger error
    let threw = false;
    try{
      await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch (e: any) {
      threw = true;
      expect(e.message).to.include('multiple payment makers');
    }
    expect(threw).toBe(true);
  });

  it('should auth using the local token if one is available', async () => {
    const f = fetchMock.createInstance();
    const db = new MemoryOAuthDb();
    // ATXP will store inbound tokens in the DB under the '' URL - this allows us to chain together
    // ATXP servers. 
    // Each downstream call will use OAuth token exchange to get a new token for the downstream server
    await db.saveAccessToken('bdj', '', {accessToken: 'testAccessToken', resourceUrl: 'https://my-current-url.com'});
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      // Respond to /authorize call 
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });
    const originalFromDb = await db.getAccessToken('bdj', 'https://example.com/mcp');
    expect(originalFromDb).toBeNull();

    const fetcher = atxpFetcher(f.fetchHandler, new Map(), db);
    const res = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    const resJson = await res.json();
    expect(resJson.content[0].type).toBe('text');
    expect(resJson.content[0].text).toBe('hello world');

    // Ensure we call the authorize endpoint
    const downstreamCalls = f.callHistory.callLogs.filter(call => call.url == 'https://example.com/mcp');
    expect(downstreamCalls.length).toBe(2);
    // Ensure there was an auth header with the exchanged token
    const headers = (downstreamCalls[1]!.args[1] as any).headers;
    const authHeader = headers instanceof Headers ? headers.get('Authorization') : headers['Authorization'];
    expect(authHeader).toBeDefined();
    expect(authHeader).toContain('Bearer ');
    const authToken = authHeader.split(' ')[1];
    expect(authToken).toBe('testAccessToken');
    const fromDb = await db.getAccessToken('bdj', 'https://example.com/mcp');
    expect(fromDb).toBeDefined();
    expect(fromDb!.accessToken).toBe('testAccessToken');
    expect(fromDb!.resourceUrl).toBe('https://example.com/mcp');
  });

  it('should bubble up OAuthAuthenticationRequiredError on OAuth challenge with no paymentMakers or local token', async () => {
    const f = fetchMock.createInstance().postOnce('https://example.com/mcp', 401);
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER);
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER);

    const fetcher = atxpFetcher(f.fetchHandler, new Map());
    await expect(fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).rejects.toThrow(OAuthAuthenticationRequiredError);
  });

  it('should throw if authorization server response is not successful', async () => {
    const f = fetchMock.createInstance()
      // 401, then succeed
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {data: 'data'});
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER);
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      // Respond to /authorize call 
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, 401, {});
    const fetcher = atxpFetcher(f.fetchHandler);

    await expect(fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).rejects.toThrow('Expected redirect response from authorization URL, got 401');
  });

  it('should throw if authorization server authorization endpoint returns an error', async () => {
    // We can't save this - the authorization URL was constructed using the client_id, so 
    // if the client registration is no longer valid, there's nothing we can do.
    const f = fetchMock.createInstance().postOnce('https://example.com/mcp', 401);
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER);
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      // Respond to /authorize call 
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          // This is how the AS responds to a bad request, as per RFC 6749
          // It just redirects back to the client without a code and with an error
          headers: {location: `https://atxp.ai?state=${state}&error=invalid_request`}
        };
      });

    const fetcher = atxpFetcher(f.fetchHandler);
    await expect(fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).rejects.toThrow('authorization response from the server is an error');
  });

  it('should handle case when payment maker lacks generateJWT method', async () => {
    const f = fetchMock.createInstance().postOnce('https://example.com/mcp', 401);
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER);
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER);

    // Mock a payment maker that doesn't have generateJWT method
    const brokenPaymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'base' }),
      getSourceAddress: vi.fn().mockReturnValue('0xAddress123')
      // Missing generateJWT method
    } as unknown as PaymentMaker;

    const fetcher = atxpFetcher(f.fetchHandler, [brokenPaymentMaker]);
    await expect(fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).rejects.toThrow('Payment maker is missing generateJWT method');
  });

  it('should call createSpendPermission and include token in auth URL for ATXP accounts', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as string).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    // Mock an ATXP-style account with createSpendPermission method
    const createSpendPermission = vi.fn().mockResolvedValue('spt_test123');
    const atxpAccount: Account & { createSpendPermission: typeof createSpendPermission } = {
      getAccountId: async () => "bdj" as any,
      paymentMakers: [paymentMaker],
      getSources: async () => [{
        address: 'SolAddress123',
        chain: 'solana' as any,
        walletType: 'eoa' as any
      }],
      createSpendPermission
    };

    const fetcher = new ATXPFetcher({
      account: atxpAccount,
      db: new MemoryOAuthDb(),
      destinationMakers: new Map(),
      fetchFn: f.fetchHandler
    });

    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Verify createSpendPermission was called with the resource URL
    expect(createSpendPermission).toHaveBeenCalledWith('https://example.com/mcp');

    // Verify the authorization URL includes the spend_permission_token
    const authCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`);
    expect(authCall).toBeDefined();
    const authUrl = new URL(authCall!.args[0] as string);
    expect(authUrl.searchParams.get('spend_permission_token')).toBe('spt_test123');
    // Also verify resource is set
    expect(authUrl.searchParams.get('resource')).toBe('https://example.com/mcp');
  });

  it('should continue auth flow if createSpendPermission fails', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as string).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    // Mock an account where createSpendPermission fails
    const createSpendPermission = vi.fn().mockRejectedValue(new Error('Network error'));
    const atxpAccount: Account & { createSpendPermission: typeof createSpendPermission } = {
      getAccountId: async () => "bdj" as any,
      paymentMakers: [paymentMaker],
      getSources: async () => [{
        address: 'SolAddress123',
        chain: 'solana' as any,
        walletType: 'eoa' as any
      }],
      createSpendPermission
    };

    const fetcher = new ATXPFetcher({
      account: atxpAccount,
      db: new MemoryOAuthDb(),
      destinationMakers: new Map(),
      fetchFn: f.fetchHandler
    });

    // Should not throw - auth flow should continue without spend permission
    const response = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(response.ok).toBe(true);

    // Verify createSpendPermission was called
    expect(createSpendPermission).toHaveBeenCalled();

    // Verify the authorization URL does NOT include spend_permission_token (since it failed)
    const authCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`);
    const authUrl = new URL(authCall!.args[0] as string);
    expect(authUrl.searchParams.get('spend_permission_token')).toBeNull();
  });

  it('should not call createSpendPermission for regular accounts without the method', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as string).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('testJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    // Regular account without createSpendPermission
    const regularAccount: Account = {
      getAccountId: async () => "bdj" as any,
      paymentMakers: [paymentMaker],
      getSources: async () => [{
        address: 'SolAddress123',
        chain: 'solana' as any,
        walletType: 'eoa' as any
      }]
    };

    const fetcher = new ATXPFetcher({
      account: regularAccount,
      db: new MemoryOAuthDb(),
      destinationMakers: new Map(),
      fetchFn: f.fetchHandler
    });

    const response = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(response.ok).toBe(true);

    // Verify the authorization URL does NOT include spend_permission_token
    const authCall = f.callHistory.lastCall(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`);
    const authUrl = new URL(authCall!.args[0] as string);
    expect(authUrl.searchParams.get('spend_permission_token')).toBeNull();
  });
});
