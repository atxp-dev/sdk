import { describe, it, expect } from 'vitest';
import { MemoryOAuthDb } from './memoryOAuthDb.js';
import type { AccessToken } from './types.js';

// AccessToken.expiresAt is Unix epoch SECONDS. These tests pin that contract,
// which the in-memory store previously got wrong (it compared seconds against
// Date.now() milliseconds, so valid tokens looked expired and vice versa).
describe('MemoryOAuthDb expiry (epoch seconds)', () => {
  const token = (expiresAt?: number): AccessToken => ({
    accessToken: 'a',
    resourceUrl: 'https://example.com',
    expiresAt
  });

  it('returns a token whose expiresAt is in the future (seconds)', async () => {
    const db = new MemoryOAuthDb();
    const t = token(Math.floor(Date.now() / 1000) + 3600);
    await db.saveAccessToken('u', 'https://example.com', t);
    expect(await db.getAccessToken('u', 'https://example.com')).toEqual(t);
    await db.close();
  });

  it('evicts a token whose expiresAt is in the past (seconds)', async () => {
    const db = new MemoryOAuthDb();
    const t = token(Math.floor(Date.now() / 1000) - 60);
    await db.saveAccessToken('u', 'https://example.com', t);
    expect(await db.getAccessToken('u', 'https://example.com')).toBeNull();
    await db.close();
  });
});
