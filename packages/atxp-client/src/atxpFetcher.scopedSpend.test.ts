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
    accountsServer?: string;
  }
) {
  // Create account with optional token and origin for spend permission tests
  // origin is derived from the connection string in ATXPAccount
  const account: Account & { token?: string; origin?: string } = {
    getAccountId: async () => "bdj" as any,
    paymentMakers: paymentMakers ?? mockPaymentMakers(),
    getSources: async () => [{
      address: 'SolAddress123',
      chain: 'solana' as any,
      walletType: 'eoa' as any
    }],
    token: options?.accountsServer ? 'test_connection_token' : undefined,
    origin: options?.accountsServer
  };

  return new ATXPFetcher({
    account,
    db: db ?? new MemoryOAuthDb(),
    destinationMakers: new Map(),
    fetchFn
  });
}

describe('atxpFetcher scoped spend token', () => {
  it('should use standard auth flow without spend permission when account has no origin/token', async () => {
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

    // No accountsServer configured - account has no origin/token
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker]);
    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Should use local generateJWT
    expect(paymentMaker.generateJWT).toHaveBeenCalled();

    // Should have resource parameter (from OAuth error's resourceServerUrl)
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    // Resource URL should be present (derived from the request)
    expect(authCalls[0].url).toContain('resource=');
    // But no spend_permission_token since account has no origin/token
    expect(authCalls[0].url).not.toContain('spend_permission_token=');
  });

  it('should call spend-permission endpoint when account has origin and token', async () => {
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

    // Account has origin and token configured
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, {
      accountsServer: 'https://accounts.atxp.ai'
    });

    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Should still use local generateJWT for the authorize request
    expect(paymentMaker.generateJWT).toHaveBeenCalled();

    // Should have called spend-permission endpoint
    const spendPermissionCalls = f.callHistory.callLogs.filter(call =>
      call.url === 'https://accounts.atxp.ai/spend-permission'
    );
    expect(spendPermissionCalls.length).toBe(1);

    // Verify the spend-permission request body contains resource URL from OAuth error
    const spendPermissionBody = JSON.parse(spendPermissionCalls[0].options?.body as string);
    expect(spendPermissionBody.resourceUrl).toBeDefined();

    // Should have passed spend_permission_token to authorize
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    const authUrl = authCalls[0].url;
    expect(authUrl).toContain('spend_permission_token=spendPermissionTokenXYZ');
    expect(authUrl).toContain('resource=');
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
      accountsServer: 'https://accounts.atxp.ai'
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

    // Create account with origin but WITHOUT token property - tests that
    // spend-permission is skipped when there's no connection token even if origin is set
    const account: Account & { origin?: string } = {
      getAccountId: async () => "bdj" as any,
      paymentMakers: [paymentMaker],
      getSources: async () => [{
        address: 'SolAddress123',
        chain: 'solana' as any,
        walletType: 'eoa' as any
      }],
      origin: 'https://accounts.atxp.ai'
    };

    const fetcher = new ATXPFetcher({
      account,
      db: new MemoryOAuthDb(),
      destinationMakers: new Map(),
      fetchFn: f.fetchHandler
    });

    const response = await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(response).toBeDefined();

    // Should NOT have called spend-permission endpoint (no token)
    const spendPermissionCalls = f.callHistory.callLogs.filter(call =>
      call.url === 'https://accounts.atxp.ai/spend-permission'
    );
    expect(spendPermissionCalls.length).toBe(0);

    // Should still have made authorize call with resource parameter
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    // Should NOT have spend_permission_token since we didn't call the endpoint
    expect(authCalls[0].url).not.toContain('spend_permission_token=');
    // Should still have resource parameter from OAuth error
    expect(authCalls[0].url).toContain('resource=');
  });
});
