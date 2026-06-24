import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthResourceClient } from './oAuthResource.js';
import { MemoryOAuthDb } from './memoryOAuthDb.js';
import type { ClientCredentials, Logger } from './types.js';

// These tests verify that introspectToken's retry-on-401/403 path only
// re-registers the client when the failure is *actually* a client-credential
// problem (`error: invalid_client`). Other 401/403 reasons (invalid_token,
// invalid_grant, network blip, AS hiccup) must NOT trigger DCR — re-registering
// rotates the shared client_secret and amplifies the failure across users.

const ISSUER = 'https://auth.example.com';

const mockAuthServerMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  introspection_endpoint: `${ISSUER}/introspect`,
  registration_endpoint: `${ISSUER}/register`,
  // oauth4webapi's introspectionRequest checks this
  introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
};

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function makeClient(fetchImpl: typeof fetch): Promise<{
  client: OAuthResourceClient;
  db: MemoryOAuthDb;
  registerSpy: ReturnType<typeof vi.spyOn>;
}> {
  const db = new MemoryOAuthDb({ logger: silentLogger });
  await db.saveClientCredentials(ISSUER, seededCredentials);
  const client = new OAuthResourceClient({
    db,
    sideChannelFetch: fetchImpl,
    logger: silentLogger,
    allowInsecureRequests: true,
  });
  // Stub registerClient so we can assert call counts without making it call out
  const registerSpy = vi
    .spyOn(client as any, 'registerClient')
    .mockImplementation(async () => {
      const rotated: ClientCredentials = {
        clientId: 'rotated-client-id',
        clientSecret: 'rotated-client-secret',
        redirectUri: 'http://localhost:3000/cb',
      };
      await db.saveClientCredentials(ISSUER, rotated);
      return rotated;
    });
  return { client, db, registerSpy };
}

describe('introspectToken — re-register only on invalid_client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT re-register when introspect returns 401 with error=invalid_token (the false-positive case)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes('/.well-known/oauth-authorization-server') || url === ISSUER || url === ISSUER + '/') {
        return jsonResponse(mockAuthServerMetadata);
      }
      if (url.includes('/introspect')) {
        // The token is bad, not the client creds. AS returns 401 with invalid_token.
        return jsonResponse({ error: 'invalid_token', error_description: 'token revoked' }, 401);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { client, registerSpy } = await makeClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.introspectToken(ISSUER, 'bad-user-token'),
    ).rejects.toThrow();

    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('does NOT re-register when introspect returns 401 with empty body (ambiguous, default safe)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes('/.well-known/oauth-authorization-server') || url === ISSUER || url === ISSUER + '/') {
        return jsonResponse(mockAuthServerMetadata);
      }
      if (url.includes('/introspect')) {
        return new Response('', { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { client, registerSpy } = await makeClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.introspectToken(ISSUER, 'some-token'),
    ).rejects.toThrow();

    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('DOES re-register when introspect returns 401 with error=invalid_client (self-healing path)', async () => {
    let introspectCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes('/.well-known/oauth-authorization-server') || url === ISSUER || url === ISSUER + '/') {
        return jsonResponse(mockAuthServerMetadata);
      }
      if (url.includes('/introspect')) {
        introspectCalls++;
        if (introspectCalls === 1) {
          return jsonResponse({ error: 'invalid_client', error_description: 'bad client creds' }, 401);
        }
        return jsonResponse({ active: true, sub: 'user-123' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { client, registerSpy } = await makeClient(fetchMock as unknown as typeof fetch);

    const result = await client.introspectToken(ISSUER, 'good-user-token');

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(result.active).toBe(true);
  });

  it('does NOT re-register on the happy path (200 active=true)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes('/.well-known/oauth-authorization-server') || url === ISSUER || url === ISSUER + '/') {
        return jsonResponse(mockAuthServerMetadata);
      }
      if (url.includes('/introspect')) {
        return jsonResponse({ active: true, sub: 'user-123' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { client, registerSpy } = await makeClient(fetchMock as unknown as typeof fetch);

    const result = await client.introspectToken(ISSUER, 'good-user-token');

    expect(registerSpy).not.toHaveBeenCalled();
    expect(result.active).toBe(true);
  });
});
