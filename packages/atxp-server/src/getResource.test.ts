import { describe, it, expect } from 'vitest';
import * as TH from './serverTestHelpers.js';
import { getResource } from './getResource.js';

describe('getResource', () => {
  it('should use config resource if set', async () => {
    const config = TH.config({resource: 'https://config-version.com/mcp', allowHttp: true});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://config-version.com/mcp');
  });

  it('should parse request url if config resource not set', async () => {
    const config = TH.config({resource: null, allowHttp: true});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should return resource for an http request', async () => {
    const config = TH.config({mountPath: '/mcp', allowHttp: true});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should strip trailing slash from url for an http request', async () => {
    const config = TH.config({mountPath: '/mcp', allowHttp: true});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp/`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should strip query string from url for an http request', async () => {
    const config = TH.config({mountPath: '/mcp', allowHttp: true});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp?query=string`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should return an https resource if the request is https', async () => {
    const config = TH.config({mountPath: '/mcp', allowHttp: true});
    const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  it('should return an http resource if the request is http in development', async () => {
    const config = TH.config({mountPath: '/mcp', allowHttp: true});
    const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('http://example.com/mcp');
  });

  it('should return an https resource in prod even if the request is http', async () => {
    const config = TH.config({mountPath: '/mcp', allowHttp: false});
    const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`));
    expect(resource.toString()).toBe('https://example.com/mcp');
  });

  describe('proxy protocol detection', () => {
    it('should detect https from X-Forwarded-Proto header', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: true});
      const headers = { 'X-Forwarded-Proto': 'https' };
      const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`), headers);
      expect(resource.toString()).toBe('https://example.com/mcp');
    });

    it('should detect http from X-Forwarded-Proto header', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: true});
      const headers = { 'X-Forwarded-Proto': 'http' };
      const resource = getResource(config, new URL(`https://example.com/.well-known/oauth-protected-resource/mcp`), headers);
      expect(resource.toString()).toBe('http://example.com/mcp');
    });

    it('should detect https from x-forwarded-proto header (lowercase)', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: true});
      const headers = { 'x-forwarded-proto': 'https' };
      const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`), headers);
      expect(resource.toString()).toBe('https://example.com/mcp');
    });

    it('should detect https from X-Forwarded-Protocol header', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: true});
      const headers = { 'X-Forwarded-Protocol': 'https' };
      const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`), headers);
      expect(resource.toString()).toBe('https://example.com/mcp');
    });

    it('should handle array values for X-Forwarded-Proto', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: true});
      const headers = { 'X-Forwarded-Proto': ['https', 'http'] };
      const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`), headers);
      expect(resource.toString()).toBe('https://example.com/mcp');
    });

    it('should fall back to request protocol when no proxy headers', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: true});
      const headers = { 'other-header': 'value' };
      const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`), headers);
      expect(resource.toString()).toBe('http://example.com/mcp');
    });

    it('should still enforce allowHttp=false even with proxy headers', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: false});
      const headers = { 'X-Forwarded-Proto': 'http' };
      const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`), headers);
      expect(resource.toString()).toBe('https://example.com/mcp');
    });

    it('should work without headers parameter', async () => {
      const config = TH.config({mountPath: '/mcp', allowHttp: true});
      const resource = getResource(config, new URL(`http://example.com/.well-known/oauth-protected-resource/mcp`));
      expect(resource.toString()).toBe('http://example.com/mcp');
    });
  });
});