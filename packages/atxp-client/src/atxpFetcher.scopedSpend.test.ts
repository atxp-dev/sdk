import { MemoryOAuthDb, Account, DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';
import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import { ATXPFetcher } from './atxpFetcher.js';
import { OAuthDb, FetchLike } from '@atxp/common';
import { PaymentMaker, ScopedSpendConfig } from './types.js';

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
    scopedSpendConfig?: ScopedSpendConfig;
  }
) {
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
    fetchFn,
    atxpAccountsServer: options?.atxpAccountsServer,
    scopedSpendConfig: options?.scopedSpendConfig
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

  it('should call resolve endpoint and accounts /sign when scopedSpendConfig is set', async () => {
    const f = fetchMock.createInstance();

    // Mock the resource server
    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401)
      .postOnce('https://example.com/mcp', {content: [{type: 'text', text: 'hello world'}]});

    // Mock auth server with all required endpoints
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const url = new URL(req.args[0] as any);
        const resolveOnly = url.searchParams.get('resolve_only');
        const state = url.searchParams.get('state');

        if (resolveOnly === 'true') {
          // Resolve endpoint - return destination account ID
          return { destinationAccountId: 'atxp_acct_destination123' };
        }

        // Normal authorize - return redirect with code
        return {
          status: 301,
          headers: {location: `https://atxp.ai?state=${state}&code=testCode`}
        };
      });

    // Mock accounts /sign endpoint
    f.post('https://accounts.atxp.ai/sign', {
      jwt: 'jwtFromAccounts',
      scopedSpendToken: 'scopedSpendTokenXYZ',
      scopedSpendTokenId: 'sst_test123',
      scopedSpendDestinationAccountId: 'atxp_acct_destination123'
    });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('localJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, {
      atxpAccountsServer: 'https://accounts.atxp.ai',
      scopedSpendConfig: { spendLimit: '100.00' }
    });

    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Should NOT use local generateJWT
    expect(paymentMaker.generateJWT).not.toHaveBeenCalled();

    // Should have called resolve endpoint
    const resolveCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('resolve_only=true')
    );
    expect(resolveCalls.length).toBe(1);

    // Should have called accounts /sign
    const signCalls = f.callHistory.callLogs.filter(call =>
      call.url === 'https://accounts.atxp.ai/sign'
    );
    expect(signCalls.length).toBe(1);

    // Verify the sign request body
    const signBody = JSON.parse(signCalls[0].options?.body as string);
    expect(signBody.destinationAccountId).toBe('atxp_acct_destination123');
    expect(signBody.spendLimit).toBe('100.00');

    // Should have passed scoped_spend_token to authorize
    const authCalls = f.callHistory.callLogs.filter(call =>
      call.url.includes('/authorize') && !call.url.includes('resolve_only=true')
    );
    expect(authCalls.length).toBeGreaterThan(0);
    const authUrl = authCalls[0].url;
    expect(authUrl).toContain('scoped_spend_token=scopedSpendTokenXYZ');
  });

  it('should throw error when resolve endpoint fails', async () => {
    const f = fetchMock.createInstance();

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401);

    // Mock auth server with all required endpoints
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const url = new URL(req.args[0] as any);
        const resolveOnly = url.searchParams.get('resolve_only');

        if (resolveOnly === 'true') {
          return {
            status: 404,
            body: JSON.stringify({ error: 'client_not_found' })
          };
        }

        return { status: 500 };
      });

    const paymentMaker = {
      makePayment: vi.fn().mockResolvedValue({ transactionId: 'testPaymentId', chain: 'solana' }),
      generateJWT: vi.fn().mockResolvedValue('localJWT'),
      getSourceAddress: vi.fn().mockReturnValue('SolAddress123')
    };

    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, {
      atxpAccountsServer: 'https://accounts.atxp.ai',
      scopedSpendConfig: { spendLimit: '100.00' }
    });

    await expect(
      fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    ).rejects.toThrow('failed to resolve destination account');
  });

  it('should throw error when accounts /sign fails', async () => {
    const f = fetchMock.createInstance();

    mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
      .postOnce('https://example.com/mcp', 401);

    // Mock auth server with all required endpoints
    mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER)
      .get(`begin:${DEFAULT_AUTHORIZATION_SERVER}/authorize`, (req) => {
        const url = new URL(req.args[0] as any);
        const resolveOnly = url.searchParams.get('resolve_only');

        if (resolveOnly === 'true') {
          return { destinationAccountId: 'atxp_acct_destination123' };
        }

        return { status: 500 };
      });

    // Mock accounts /sign endpoint - fails
    f.post('https://accounts.atxp.ai/sign', {
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
      scopedSpendConfig: { spendLimit: '100.00' }
    });

    await expect(
      fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    ).rejects.toThrow('accounts /sign failed');
  });

  it('should use standard auth when atxpAccountsServer is not set even with scopedSpendConfig', async () => {
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

    // Set scopedSpendConfig but NOT atxpAccountsServer
    const fetcher = atxpFetcher(f.fetchHandler, [paymentMaker], undefined, {
      scopedSpendConfig: { spendLimit: '100.00' }
      // Note: atxpAccountsServer not set
    });

    await fetcher.fetch('https://example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

    // Should fall back to local generateJWT
    expect(paymentMaker.generateJWT).toHaveBeenCalled();
  });
});
