import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { OAuthResourceClient } from './oAuthResource.js';
import { MemoryOAuthDb } from './memoryOAuthDb.js';
import type { ClientCredentials, Logger } from './types.js';

// Real-HTTP integration test: a tiny local Express AS lets us verify end-to-end
// that introspectToken's retry logic (1) does not re-register on non-credential
// 401/403s (the dominant /register volume driver), and (2) does still self-heal
// on `invalid_client`. This is one rung up from the mocked-fetch unit tests:
// it exercises the actual oauth4webapi HTTP path.

let server: Server;
let baseUrl: string;
let issuer: string;
let registerCalls = 0;
let introspectCalls = 0;
let introspectResponder: () => { status: number; body: unknown; contentType?: string } = () => ({
  status: 200,
  body: { active: true, sub: 'user-123' },
});

const seededCredentials: ClientCredentials = {
  clientId: 'seeded-client-id',
  clientSecret: 'seeded-client-secret',
  redirectUri: 'http://localhost:3000/cb',
};

const silentLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Set up base URL placeholder; rewritten after listen()
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      introspection_endpoint: `${issuer}/introspect`,
      registration_endpoint: `${issuer}/register`,
      introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
      response_types_supported: ['code'],
    });
  });

  app.post('/introspect', (_req, res) => {
    introspectCalls++;
    const r = introspectResponder();
    const ct = r.contentType ?? 'application/json';
    res.status(r.status).type(ct);
    if (ct === 'application/json') {
      res.send(JSON.stringify(r.body));
    } else {
      res.send(String(r.body));
    }
  });

  app.post('/register', (_req, res) => {
    registerCalls++;
    res.status(201).json({
      client_id: `rotated-client-${registerCalls}`,
      client_secret: `rotated-secret-${registerCalls}`,
      client_secret_expires_at: 0,
      redirect_uris: [seededCredentials.redirectUri],
    });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://127.0.0.1:${port}`;
  issuer = baseUrl;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  registerCalls = 0;
  introspectCalls = 0;
});

async function makeClient(): Promise<OAuthResourceClient> {
  const db = new MemoryOAuthDb({ logger: silentLogger });
  await db.saveClientCredentials(issuer, seededCredentials);
  return new OAuthResourceClient({
    db,
    logger: silentLogger,
    allowInsecureRequests: true,
  });
}

describe('introspectToken — real-HTTP retry behavior', () => {
  it('does NOT call /register when AS returns 401 invalid_token (false-positive)', async () => {
    introspectResponder = () => ({
      status: 401,
      body: { error: 'invalid_token', error_description: 'token revoked' },
    });
    const client = await makeClient();

    await expect(client.introspectToken(issuer, 'bad-user-token')).rejects.toThrow();

    expect(registerCalls).toBe(0);
  });

  it('does NOT call /register when AS returns 401 with empty body', async () => {
    introspectResponder = () => ({ status: 401, body: '', contentType: 'text/plain' });
    const client = await makeClient();

    await expect(client.introspectToken(issuer, 'whatever')).rejects.toThrow();

    expect(registerCalls).toBe(0);
  });

  it('DOES call /register exactly once when AS returns 401 invalid_client, then succeeds on retry', async () => {
    introspectResponder = () =>
      introspectCalls === 1
        ? { status: 401, body: { error: 'invalid_client' } }
        : { status: 200, body: { active: true, sub: 'user-456' } };

    const client = await makeClient();
    const result = await client.introspectToken(issuer, 'good-user-token');

    expect(registerCalls).toBe(1);
    expect(result.active).toBe(true);
  });

  it('does NOT call /register on the happy path (200 active=true)', async () => {
    introspectResponder = () => ({
      status: 200,
      body: { active: true, sub: 'user-789' },
    });
    const client = await makeClient();

    const result = await client.introspectToken(issuer, 'good-user-token');

    expect(registerCalls).toBe(0);
    expect(result.active).toBe(true);
  });
});

describe('introspectToken — shared-client (atxp-pics-style multi-user) behavior', () => {
  // Mirrors the shape of atxp-pics/src/lib/mcp.ts: one shared OAuthDb (the
  // singleton), many OAuthResourceClient instances (one per user request).
  // Verifies that after the bug fix, sustained per-request usage does NOT
  // produce sustained /register calls — one call at cold start per issuer,
  // then zero on every subsequent request.

  it('cold start: many concurrent users with empty shared db produce at most one register burst, then zero', async () => {
    introspectResponder = () => ({
      status: 200,
      body: { active: true, sub: 'shared-test-user' },
    });
    // Empty shared db — first wave of users will trigger DCR
    const sharedDb = new MemoryOAuthDb({ logger: silentLogger });

    // 10 concurrent first-time users, each in their own OAuthResourceClient
    // (atxp-pics creates a fresh atxpFetcher → OAuthClient per request)
    const firstWave = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const client = new OAuthResourceClient({
          db: sharedDb,
          logger: silentLogger,
          allowInsecureRequests: true,
        });
        return client.introspectToken(issuer, 'token-' + Math.random());
      }),
    );

    expect(firstWave.every((r) => r.active === true)).toBe(true);

    // Cold-start race: per-instance registrationLocks means up to N concurrent
    // registers can fire before the shared db gets populated. We document the
    // current upper bound (it should be small and bounded, not unbounded).
    const coldStartRegisters = registerCalls;
    expect(coldStartRegisters).toBeGreaterThan(0);
    expect(coldStartRegisters).toBeLessThanOrEqual(10);

    // After the cold-start storm, the shared db is populated.
    // Now: 50 more requests over time. None should trigger /register because
    // the happy path returns 200, and shared db has cached credentials.
    registerCalls = 0;
    const steadyState = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const client = new OAuthResourceClient({
          db: sharedDb,
          logger: silentLogger,
          allowInsecureRequests: true,
        });
        return client.introspectToken(issuer, 'token-' + Math.random());
      }),
    );
    expect(steadyState.every((r) => r.active === true)).toBe(true);

    // This is the key assertion: in the happy case, sustained traffic produces
    // ZERO additional /register calls — because the AS returns 200 and we
    // never enter the false-positive retry path.
    expect(registerCalls).toBe(0);
  });

  it('steady-state with intermittent 401 invalid_token (false-positive scenario): ZERO registers', async () => {
    // This is the load pattern that was producing 1.2M /register/day in prod:
    // many users, occasional introspect 401 because the user token is bad,
    // and the SDK was wrongly treating each one as bad client creds.
    let i = 0;
    introspectResponder = () => {
      i++;
      // Every 5th request returns 401 invalid_token (a bad user token)
      return i % 5 === 0
        ? { status: 401, body: { error: 'invalid_token' } }
        : { status: 200, body: { active: true, sub: 'u' + i } };
    };

    const sharedDb = new MemoryOAuthDb({ logger: silentLogger });
    await sharedDb.saveClientCredentials(issuer, seededCredentials);

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, async () => {
        const client = new OAuthResourceClient({
          db: sharedDb,
          logger: silentLogger,
          allowInsecureRequests: true,
        });
        return client.introspectToken(issuer, 'token-' + Math.random());
      }),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(40);
    expect(rejected).toBe(10);

    // CRITICAL: zero /register calls despite 10 401s.
    // Pre-fix: this would have been ~10 /register calls per 50 introspects.
    // At 1.2M/day in prod, that ratio matches the observed volume.
    expect(registerCalls).toBe(0);
  });
});
