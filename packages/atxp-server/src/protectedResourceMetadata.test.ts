import { describe, it, expect } from 'vitest';
import { getProtectedResourceMetadata } from './protectedResourceMetadata.js';
import * as TH from './serverTestHelpers.js';

describe('getProtectedResourceMetadata', () => {
  it('should return protected resource metadata', async () => {
    const config = TH.config();
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com'),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  it('should use payeeName as the resource_name', async () => {
    const config = TH.config({payeeName: 'test-payee'});
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com'),
      resource_name: 'test-payee',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  it('should return null for a request that does not match the mountPath', async () => {
    const config = TH.config({mountPath: '/'});
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource/some/sub/path'));
    expect(metadata).toBeNull();
  });

  it('should return null for a request that does not match the PRM path', async () => {
    const config = TH.config();
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/some/random/path'));
    expect(metadata).toBeNull();
  });

  it('should return null for a request to the root', async () => {
    const config = TH.config();
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com'));
    expect(metadata).toBeNull();
  });

  it('should return PRM metadata for a url with a trailing slash', async () => {
    const config = TH.config();
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource/'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com'),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  it('should return PRM metadata for a url without a trailing slash', async () => {
    const config = TH.config();
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com'),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  it('should return PRM metadata for a non-root mountPath with a trailing slash', async () => {
    const config = TH.config({mountPath: '/mcp/'});
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource/mcp/'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com/mcp'),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  it('should return PRM metadata for a non-root mountPath without a trailing slash', async () => {
    const config = TH.config({mountPath: '/mcp'});
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource/mcp/'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com/mcp'),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  it('should return PRM metadata for a non-root path with a query string', async () => {
    const config = TH.config({mountPath: '/mcp'});
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource/mcp?query=string'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com/mcp'),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });

  it('should return PRM metadata for the message path', async () => {
    const config = TH.config({mountPath: '/mcp'});
    const metadata = getProtectedResourceMetadata(config, new URL('https://example.com/.well-known/oauth-protected-resource/mcp/message'));
    expect(metadata).toMatchObject({
      resource: new URL('https://example.com/mcp/message'),
      resource_name: 'Test ATXP Server',
      authorization_servers: ['https://auth.atxp.ai'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    });
  });
});