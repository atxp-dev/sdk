import { describe, it, expect } from 'vitest';
import { getOAuthMetadata } from './oAuthMetadata.js';
import * as TH from './serverTestHelpers.js';

const METADATA = {
  issuer: 'https://auth.atxp.ai',
  authorization_endpoint: 'https://auth.atxp.ai/authorize',
  response_types_supported: ['code', 'token'],
  grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
  token_endpoint: 'https://auth.atxp.ai/token',
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  registration_endpoint: 'https://auth.atxp.ai/register',
  revocation_endpoint: 'https://auth.atxp.ai/revoke',
  introspection_endpoint: 'https://auth.atxp.ai/introspect',
  introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['read', 'write']
}

describe('getOAuthMetadata', () => {
  it('should return OAuth metadata', async () => {
    const config = TH.config({oAuthClient: TH.oAuthClient({authorizationServer: METADATA})});
    const metadata = await getOAuthMetadata(config, new URL('https://example.com/.well-known/oauth-authorization-server'));
    expect(metadata).toMatchObject(METADATA);
  });

  it('should return null for a request that does not match the mountPath', async () => {
    const config = TH.config({oAuthClient: TH.oAuthClient({authorizationServer: METADATA})});
    const metadata = await getOAuthMetadata(config, new URL('https://example.com/.well-known/oauth-authorization-server/some/sub/path'));
    expect(metadata).toBeNull();
  });

  it('should return null for a request that does not match the OAuth path', async () => {
    const config = TH.config({oAuthClient: TH.oAuthClient({authorizationServer: METADATA})});
    const metadata = await getOAuthMetadata(config, new URL('https://example.com/some/random/path'));
    expect(metadata).toBeNull();
  });

  it('should return null for a request to the root', async () => {
    const config = TH.config({oAuthClient: TH.oAuthClient({authorizationServer: METADATA})});
    const metadata = await getOAuthMetadata(config, new URL('https://example.com'));
    expect(metadata).toBeNull();
  });

  it('should return OAuth metadata for a url with a trailing slash', async () => {
    const config = TH.config({oAuthClient: TH.oAuthClient({authorizationServer: METADATA})});
    const metadata = await getOAuthMetadata(config, new URL('https://example.com/.well-known/oauth-authorization-server/'));
    expect(metadata).toMatchObject(METADATA);
  });

  it('should return OAuth metadata for a url without a trailing slash', async () => {
    const config = TH.config({oAuthClient: TH.oAuthClient({authorizationServer: METADATA})});
    const metadata = await getOAuthMetadata(config, new URL('https://example.com/.well-known/oauth-authorization-server'));
    expect(metadata).toMatchObject(METADATA);
  });
});