import { OAuthAuthenticationRequiredError } from './oAuth.js';
import { describe, it, expect } from 'vitest';

describe('OAuthAuthenticationRequiredError', () => {
  it('should return the same idempotencyKey for the same url, resource server url, and token', async () => {
    const url = 'https://foo.com/mcp';
    const resourceServerUrl = 'https://example.com';
    const token = 'test-token';
    const error1 = await OAuthAuthenticationRequiredError.create(url, resourceServerUrl, token);
    const error2 = await OAuthAuthenticationRequiredError.create(url, resourceServerUrl, token);
    expect(error1.idempotencyKey).toBe(error2.idempotencyKey);
  });

  it('should return the same idempotencyKey as long as the url base is the same', async () => {
    const url1 = 'https://foo.com/mcp?a=b';
    const url2 = 'https://foo.com/mcp?y=z';
    const resourceServerUrl = 'https://example.com';
    const token = 'test-token';
    const error1 = await OAuthAuthenticationRequiredError.create(url1, resourceServerUrl, token);
    const error2 = await OAuthAuthenticationRequiredError.create(url2, resourceServerUrl, token);
    expect(error1.url).toBe(url1);
    expect(error2.url).toBe(url2);
    expect(error1.idempotencyKey).toBe(error2.idempotencyKey);
  });

  it('should return an idempotencyKey for undefined/null tokens', async () => {
    const url = 'https://foo.com/mcp';
    const resourceServerUrl = 'https://example.com';
    const error = await OAuthAuthenticationRequiredError.create(url, resourceServerUrl, undefined);
    expect(error.idempotencyKey.length).toBeGreaterThan(10);
  });

  it('should return different idempotencyKeys for different tokens', async () => {
    const url = 'https://foo.com/mcp';
    const resourceServerUrl = 'https://example.com';
    const token1 = 'test-token';
    const token2 = 'test-token2';
    const error1 = await OAuthAuthenticationRequiredError.create(url, resourceServerUrl, token1);
    const error2 = await OAuthAuthenticationRequiredError.create(url, resourceServerUrl, token2);
    const error3 = await OAuthAuthenticationRequiredError.create(url, resourceServerUrl, undefined);
    expect(error1.idempotencyKey).not.toBe(error2.idempotencyKey);
    expect(error1.idempotencyKey).not.toBe(error3.idempotencyKey);
    expect(error2.idempotencyKey).not.toBe(error3.idempotencyKey);
  });
});