import { MemoryOAuthDb, Account, DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';
import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import { ATXPFetcher } from './atxpFetcher.js';
import { OAuthDb, FetchLike } from '@atxp/common';
import { PaymentMaker } from './types.js';

function mockPaymentMakers(solanaPaymentMaker?: PaymentMaker) {
  solanaPaymentMaker = solanaPaymentMaker ?? {
    makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
    generateJWT: vi.fn().mockResolvedValue('testJWT'),
    getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
  };
  return [solanaPaymentMaker];
}

function atxpFetcher(
  fetchFn: FetchLike,
  paymentMakers?: PaymentMaker[],
  db?: OAuthDb,
  options?: {
    atxpAccountsServer?: string;
    mcpServer?: string;
  }
) {
  // Create account with optional token for spend permission tests
  const account: Account & { token?: string } = {
    getAccountId: async () => "bdj" as any,
    paymentMakers: paymentMakers ?? mockPaymentMakers(),
    getSources: async () => [{
      address: 'SolAddress123',
      chain: 'solana' as any,
      walletType: 'eoa' as any
    }],
    token: options?.atxpAccountsServer ? 'test_connection_token' : undefined
  };

  return new ATXPFetcher({
    account,
    db: db ?? new MemoryOAuthDb(),
    destinationMakers: new Map(),
    fetchFn,
    atxpAccountsServer: options?.atxpAccountsServer,
    mcpServer: options?.mcpServer
  });
}

describe('atxpFetcher scoped spend token', () => {
  it('should use standard auth flow when scopedSpendConfig is not set', async () => {
    const f = fetchMock.createInstance();
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('standardJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Should use local generateJWT
    expect(paymentMaker.generateJWT).toHaveBeenCalled();

    // Ensure no calls to resolve endpoint
    const resolveCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('resolve_only=true')
    );
    expect(resolveCalls.length).toBe(0);
  });

  it('should call spend-permission endpoint when mcpServer is set', async () => {
    const f = fetchMock.createInstance();

    // Mock the resource server
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});

    // Mock auth server with all required endpoints
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    // Mock accounts /spend-permission endpoint
    f.post('https://accounts.atxp.ai/spend-permission', {
      spendPermissionToken: 'spendPermissionTokenXYZ'
    });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('localJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, {
      atxpAccountsServer: 'https://accounts.atxp.ai',
      mcpServer: 'https://example.com/mcp'
    });

    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Should still use local generateJWT for the authorize request
    expect(paymentMaker.generateJWT).toHaveBeenCalled();

    // Should have called spend-permission endpoint
    const spendPermissionCalls = f.callHistory.callLogs.filter(call =>
      call.url === 'https://accounts.atxp.ai/spend-permission'
    );
    expect(spendPermissionCalls.length).toBe(1);

    // Verify the spend-permission request body
    const spendPermissionBody = JSON.parse(spendPermissionCalls[0].options?.body as string);
    expect(spendPermissionBody.resourceUrl).toBe('https://example.com/mcp');

    // Should have passed spend_permission_token to authorize
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    const authUrl = authCalls[0].url;
    expect(authUrl).toContain('spend_permission_token=spendPermissionTokenXYZ');
    expect(authUrl).toContain('resource=https%3A%2F%2Fexample.com%2Fmcp');
  });

  it('should gracefully continue when spend-permission endpoint fails', async () => {
    const f = fetchMock.createInstance();

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});

    // Mock auth server with all required endpoints
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    // Mock accounts /spend-permission endpoint - return error
    f.post('https://accounts.atxp.ai/spend-permission', {
      status: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('localJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, {
      atxpAccountsServer: 'https://accounts.atxp.ai',
      mcpServer: 'https://example.com/mcp'
    });

    // Should not throw - should gracefully continue without spend permission token
    const response = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(response).toBeDefined();

    // Should have attempted spend-permission endpoint
    const spendPermissionCalls = f.callHistory.callLogs.filter(call =>
      call.url === 'https://accounts.atxp.ai/spend-permission'
    );
    expect(spendPermissionCalls.length).toBe(1);

    // Should still have made authorize call (without spend_permission_token)
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    // Should NOT have spend_permission_token since it failed
    expect(authCalls[0].url).not.toContain('spend_permission_token=');
  });

  it('should skip spend-permission when no connection token available', async () => {
    const f = fetchMock.createInstance();

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});

    // Mock auth server with all required endpoints
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('localJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    // Create account WITHOUT token property
    const account: Account = {
      getAccountId: async () => "bdj" as any,
      paymentMakers: [paymentMaker],
      getSources: async () => [{
        address: 'SolAddress123',
        chain: 'solana' as any,
        walletType: 'eoa' as any
      }]
    };

    const fetcher = new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers: new Map(),
      fetchFn: f.fetchHandler,
      atxpAccountsServer: 'https://accounts.atxp.ai',
      mcpServer: 'https://example.com/mcp'
    });

    const response = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(response).toBeDefined();

    // Should NOT have called spend-permission endpoint (no token)
    const spendPermissionCalls = f.callHistory.callLogs.filter(call =>
      call.url === 'https://accounts.atxp.ai/spend-permission'
    );
    expect(spendPermissionCalls.length).toBe(0);

    // Should still have made authorize call
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    // Should NOT have spend_permission_token since we didn't call the endpoint
    expect(authCalls[0].url).not.toContain('spend_permission_token=');
    // Should still have resource parameter
    expect(authCalls[0].url).toContain('resource=https%3A%2F%2Fexample.com%2Fmcp');
  });

  it('should skip spend-permission when mcpServer is not set even with atxpAccountsServer', async () => {
    const f = fetchMock.createInstance();

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const state = new URL(req.args[0] as any).searchParams.get('state');
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('standardJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    // Set atxpAccountsServer but NOT mcpServer
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, {
      atxpAccountsServer: 'https://accounts.atxp.ai'
      // Note: mcpServer not set
    });

    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Should use local generateJWT
    expect(paymentMaker.generateJWT).toHaveBeenCalled();

    // Should NOT have called spend-permission endpoint (no mcpServer)
    const spendPermissionCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/spend-permission')
    );
    expect(spendPermissionCalls.length).toBe(0);

    // Should NOT have resource or spend_permission_token params
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    expect(authCalls[0].url).not.toContain('resource=');
    expect(authCalls[0].url).not.toContain('spend_permission_token=');
  });
});
