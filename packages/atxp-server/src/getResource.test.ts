import { describe, it, expect } from 'vitest';
import * as TH from './serverTestHelpers.js';
import { getResource } from './getResource.js';

describe('getResource', () => {
  it('should use config resource if set', async () => {
    const config = TH.config({resource: 'https://config-version.com/mcp'});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://config-version.com/mcp');
  });

  it('should parse request url if config resource not set', async () => {
    const config = TH.config({resource: null});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should return resource for an http request', async () => {
    const config = TH.config({mountPath: '/mcp'});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should strip trailing slash from url for an http request', async () => {
    const config = TH.config({mountPath: '/mcp'});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp/`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should strip query string from url for an http request', async () => {
    const config = TH.config({mountPath: '/mcp'});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp?query=string`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should return an https resource if the request is https', async () => {
    const config = TH.config({mountPath: '/mcp'});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should return an http resource if the request is http in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const config = TH.config({mountPath: '/mcp'});
    const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('http://example.com/mcp');
    process.env.NODE_ENV = originalEnv;
  });

  it('should return an https resource in prod even if the request is http', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const config = TH.config({mountPath: '/mcp'});
    const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
    process.env.NODE_ENV = originalEnv;
  });
});