import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedisOAuthDb } from './index.js';
import type { AccessToken, ClientCredentials, PKCEValues } from '@atxp/common';

// Mock Redis client for unit tests
const createMockRedisClient = () => {
  const store = new Map<string, string>();
  const ttlStore = new Map<string, number>();

  return {
    get: vi.fn(async (key: string) => {
      const ttl = ttlStore.get(key);
      if (ttl && ttl < Date.now()) {
        store.delete(key);
        ttlStore.delete(key);
        return null;
      }
      return store.get(key) || null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    setex: vi.fn(async (key: string, seconds: number, value: string) => {
      store.set(key, value);
      ttlStore.set(key, Date.now() + seconds * 1000);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      ttlStore.delete(key);
      return existed ? 1 : 0;
    }),
    quit: vi.fn(async () => 'OK'),
    
    // Expose internal store for testing
    _store: store,
    _ttlStore: ttlStore,
  };
};

describe('RedisOAuthDb', () => {
  let mockRedis: ReturnType<typeof createMockRedisClient>;
  let db: RedisOAuthDb;

  beforeEach(() => {
    mockRedis = createMockRedisClient();
    db = new RedisOAuthDb({
      redis: mockRedis,
      keyPrefix: 'test:oauth:',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Client Credentials', () => {
    const resourceUrl = 'https://example.com';
    const credentials: ClientCredentials = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'https://example.com/callback'
    };

    it('should save and retrieve client credentials', async () => {
      await db.saveClientCredentials(resourceUrl, credentials);
      const retrieved = await db.getClientCredentials(resourceUrl);
      
      expect(retrieved).toEqual(credentials);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'test:oauth:client_credentials:https://example.com',
        expect.stringContaining('test-client-id')
      );
    });

    it('should return null for non-existent client credentials', async () => {
      const retrieved = await db.getClientCredentials('https://nonexistent.com');
      expect(retrieved).toBeNull();
    });

    it('should store encrypted data in Redis', async () => {
      await db.saveClientCredentials(resourceUrl, credentials);
      
      // Check that the data was stored in Redis
      const key = 'test:oauth:client_credentials:https://example.com';
      const storedData = mockRedis._store.get(key);
      expect(storedData).toBeDefined();
      
      // Data should be JSON
      const parsed = JSON.parse(storedData!);
      expect(parsed.encrypted_client_id).toBe('test-client-id'); // No encryption in this test
      expect(parsed.encrypted_client_secret).toBe('test-client-secret');
    });
  });

  describe('PKCE Values', () => {
    const userId = 'test-user';
    const state = 'test-state';
    const pkceValues: PKCEValues = {
      codeVerifier: 'test-code-verifier',
      codeChallenge: 'test-code-challenge',
      resourceUrl: 'https://example.com',
      url: 'https://example.com/oauth'
    };

    it('should save and retrieve PKCE values', async () => {
      await db.savePKCEValues(userId, state, pkceValues);
      const retrieved = await db.getPKCEValues(userId, state);
      
      expect(retrieved).toEqual(pkceValues);
    });

    it('should return null for non-existent PKCE values', async () => {
      const retrieved = await db.getPKCEValues('nonexistent-user', 'nonexistent-state');
      expect(retrieved).toBeNull();
    });

    it('should set TTL for PKCE values', async () => {
      await db.savePKCEValues(userId, state, pkceValues);
      
      // Should use setex for PKCE values (they have a fixed TTL)
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'test:oauth:pkce:test-user:test-state',
        600, // 10 minutes
        expect.any(String)
      );
    });
  });

  describe('Access Tokens', () => {
    const userId = 'test-user';
    const url = 'https://example.com';
    const accessToken: AccessToken = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      resourceUrl: 'https://example.com'
    };

    it('should save and retrieve access tokens', async () => {
      await db.saveAccessToken(userId, url, accessToken);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(accessToken);
    });

    it('should return null for non-existent access tokens', async () => {
      const retrieved = await db.getAccessToken('nonexistent-user', 'https://nonexistent.com');
      expect(retrieved).toBeNull();
    });

    it('should handle expired tokens', async () => {
      const expiredToken: AccessToken = {
        accessToken: 'expired-token',
        expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        resourceUrl: 'https://example.com'
      };

      await db.saveAccessToken(userId, url, expiredToken);
      
      const retrieved = await db.getAccessToken(userId, url);
      expect(retrieved).toBeNull();
      
      // Should have deleted the expired token
      const key = 'test:oauth:access_token:test-user:https://example.com';
      expect(mockRedis.del).toHaveBeenCalledWith(key);
    });

    it('should use token expiration for TTL when available', async () => {
      await db.saveAccessToken(userId, url, accessToken);
      
      // Should calculate TTL from token expiration
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'test:oauth:access_token:test-user:https://example.com',
        expect.any(Number), // TTL calculated from expiresAt
        expect.any(String)
      );
      
      // TTL should be positive and reasonable (within 1 hour)
      const call = mockRedis.setex.mock.calls.find(call => 
        call[0] === 'test:oauth:access_token:test-user:https://example.com'
      );
      expect(call![1]).toBeGreaterThan(0);
      expect(call![1]).toBeLessThanOrEqual(3600);
    });
  });

  describe('Encryption Support', () => {
    it('should support custom encryption/decryption functions', async () => {
      const encryptedDb = new RedisOAuthDb({
        redis: mockRedis,
        keyPrefix: 'test:encrypted:',
        encrypt: (data: string) => Buffer.from(data).toString('base64'),
        decrypt: (data: string) => Buffer.from(data, 'base64').toString()
      });

      const credentials: ClientCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/callback'
      };

      await encryptedDb.saveClientCredentials('https://example.com', credentials);
      const retrieved = await encryptedDb.getClientCredentials('https://example.com');

      expect(retrieved).toEqual(credentials);
      
      // Check that data was encrypted in storage
      const key = 'test:encrypted:client_credentials:https://example.com';
      const storedData = mockRedis._store.get(key);
      const parsed = JSON.parse(storedData!);
      
      // Data should be base64 encoded
      expect(parsed.encrypted_client_id).toBe(Buffer.from('test-client-id').toString('base64'));
      expect(parsed.encrypted_client_secret).toBe(Buffer.from('test-client-secret').toString('base64'));

      await encryptedDb.close();
    });
  });

  describe('Key Management', () => {
    it('should use correct key prefixes', async () => {
      const credentials: ClientCredentials = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://test.com/callback'
      };

      await db.saveClientCredentials('https://test.com', credentials);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'test:oauth:client_credentials:https://test.com',
        expect.any(String)
      );
    });

    it('should support custom key prefixes', async () => {
      const customDb = new RedisOAuthDb({
        redis: mockRedis,
        keyPrefix: 'myapp:auth:'
      });

      const credentials: ClientCredentials = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://test.com/callback'
      };

      await customDb.saveClientCredentials('https://test.com', credentials);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'myapp:auth:client_credentials:https://test.com',
        expect.any(String)
      );

      await customDb.close();
    });
  });

  describe('TTL Configuration', () => {
    it('should use configured default TTL for tokens without expiration', async () => {
      const ttlDb = new RedisOAuthDb({
        redis: mockRedis,
        keyPrefix: 'test:ttl:',
        ttl: 1800 // 30 minutes
      });

      const tokenWithoutExpiry: AccessToken = {
        accessToken: 'no-expiry-token',
        resourceUrl: 'https://example.com'
      };

      await ttlDb.saveAccessToken('user', 'https://example.com', tokenWithoutExpiry);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'test:ttl:access_token:user:https://example.com',
        1800, // Configured TTL
        expect.any(String)
      );

      await ttlDb.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection errors gracefully', async () => {
      const errorRedis = {
        get: vi.fn().mockRejectedValue(new Error('Redis connection error')),
        set: vi.fn().mockRejectedValue(new Error('Redis connection error')),
        setex: vi.fn().mockRejectedValue(new Error('Redis connection error')),
        del: vi.fn().mockRejectedValue(new Error('Redis connection error')),
        quit: vi.fn().mockResolvedValue('OK'),
      };

      const errorDb = new RedisOAuthDb({ redis: errorRedis });

      await expect(errorDb.getClientCredentials('https://example.com')).rejects.toThrow('Redis connection error');
      
      await errorDb.close();
    });

    it('should handle close gracefully', async () => {
      await db.close();
      expect(mockRedis.quit).toHaveBeenCalled();
      
      // Second close should not throw
      await expect(db.close()).resolves.not.toThrow();
    });
  });
});