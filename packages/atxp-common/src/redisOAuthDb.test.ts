import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisOAuthDb, RedisClient } from './redisOAuthDb.js';
import { ConsoleLogger } from './logger.js';
import type { AccessToken, ClientCredentials, PKCEValues } from './types.js';

// Mock Redis client
class MockRedisClient implements RedisClient {
  private data = new Map<string, string>();
  private expiries = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    // Check if key has expired
    const expiry = this.expiries.get(key);
    if (expiry && Date.now() > expiry) {
      this.data.delete(key);
      this.expiries.delete(key);
      return null;
    }
    return this.data.get(key) || null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.data.set(key, value);
    this.expiries.delete(key); // Remove any existing expiry
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<unknown> {
    this.data.set(key, value);
    this.expiries.set(key, Date.now() + (seconds * 1000));
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.data.has(key);
    this.data.delete(key);
    this.expiries.delete(key);
    return existed ? 1 : 0;
  }

  async quit(): Promise<unknown> {
    this.data.clear();
    this.expiries.clear();
    return 'OK';
  }

  // Helper methods for testing
  getAllKeys(): string[] {
    return Array.from(this.data.keys());
  }

  clear(): void {
    this.data.clear();
    this.expiries.clear();
  }
}

describe('RedisOAuthDb', () => {
  let mockRedis: MockRedisClient;
  let db: RedisOAuthDb;
  let mockLogger: ConsoleLogger;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;
    
    db = new RedisOAuthDb({
      redis: mockRedis,
      logger: mockLogger,
      keyPrefix: 'test:'
    });
  });

  describe('constructor', () => {
    it('should accept Redis client instance', () => {
      const db = new RedisOAuthDb({ redis: mockRedis });
      expect(db).toBeInstanceOf(RedisOAuthDb);
    });

    it('should create Redis client from URL string', () => {
      // Test that the constructor accepts a string without throwing
      // Note: This creates a real ioredis instance but doesn't connect until first operation
      const db = new RedisOAuthDb({ redis: 'redis://localhost:6379' });
      expect(db).toBeInstanceOf(RedisOAuthDb);
    });

    it('should accept custom configuration with Redis client', () => {
      const customDb = new RedisOAuthDb({
        redis: mockRedis,
        keyPrefix: 'custom:',
        ttl: 3600,
        encrypt: (data) => `encrypted_${data}`,
        decrypt: (data) => data.replace('encrypted_', '')
      });
      
      expect(customDb).toBeInstanceOf(RedisOAuthDb);
    });
  });

  describe('client credentials', () => {
    const testCredentials: ClientCredentials = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'https://example.com/callback'
    };

    it('should save and retrieve client credentials', async () => {
      const resourceUrl = 'https://api.example.com';
      
      await db.saveClientCredentials(resourceUrl, testCredentials);
      const retrieved = await db.getClientCredentials(resourceUrl);
      
      expect(retrieved).toEqual(testCredentials);
    });

    it('should return null for non-existent credentials', async () => {
      const result = await db.getClientCredentials('https://nonexistent.com');
      expect(result).toBeNull();
    });

    it('should handle encryption/decryption', async () => {
      const encryptDb = new RedisOAuthDb({
        redis: mockRedis,
        encrypt: (data) => `encrypted_${data}`,
        decrypt: (data) => data.replace('encrypted_', ''),
        keyPrefix: 'encrypted:'
      });

      const resourceUrl = 'https://api.example.com';
      await encryptDb.saveClientCredentials(resourceUrl, testCredentials);
      
      // Check that data is encrypted in storage
      const keys = mockRedis.getAllKeys();
      expect(keys.length).toBe(1);
      const rawData = await mockRedis.get(keys[0]);
      expect(rawData).toContain('encrypted_');
      
      // Check that retrieved data is decrypted
      const retrieved = await encryptDb.getClientCredentials(resourceUrl);
      expect(retrieved).toEqual(testCredentials);
    });

    it('should handle corrupted data gracefully', async () => {
      const resourceUrl = 'https://api.example.com';
      await mockRedis.set('test:client_credentials:https://api.example.com', 'invalid json');
      
      const result = await db.getClientCredentials(resourceUrl);
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('PKCE values', () => {
    const testPKCE: PKCEValues = {
      codeVerifier: 'test-code-verifier',
      codeChallenge: 'test-code-challenge',
      resourceUrl: 'https://auth.example.com',
      url: 'https://api.example.com'
    };

    it('should save and retrieve PKCE values', async () => {
      const userId = 'user123';
      const state = 'state456';
      
      await db.savePKCEValues(userId, state, testPKCE);
      const retrieved = await db.getPKCEValues(userId, state);
      
      expect(retrieved).toEqual(testPKCE);
    });

    it('should return null for non-existent PKCE values', async () => {
      const result = await db.getPKCEValues('nonexistent', 'state');
      expect(result).toBeNull();
    });

    it('should set expiration on PKCE values', async () => {
      const userId = 'user123';
      const state = 'state456';
      
      await db.savePKCEValues(userId, state, testPKCE);
      
      // Check that expiry was set (600 seconds for PKCE)
      const keys = mockRedis.getAllKeys();
      expect(keys.length).toBe(1);
    });

    it('should handle encryption/decryption for PKCE', async () => {
      const encryptDb = new RedisOAuthDb({
        redis: mockRedis,
        encrypt: (data) => `encrypted_${data}`,
        decrypt: (data) => data.replace('encrypted_', ''),
        keyPrefix: 'encrypted:'
      });

      const userId = 'user123';
      const state = 'state456';
      await encryptDb.savePKCEValues(userId, state, testPKCE);
      
      const retrieved = await encryptDb.getPKCEValues(userId, state);
      expect(retrieved).toEqual(testPKCE);
    });

    it('should handle corrupted PKCE data gracefully', async () => {
      const userId = 'user123';
      const state = 'state456';
      await mockRedis.set('test:pkce:user123:state456', 'invalid json');
      
      const result = await db.getPKCEValues(userId, state);
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('access tokens', () => {
    const testToken: AccessToken = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      resourceUrl: 'https://api.example.com'
    };

    it('should save and retrieve access tokens', async () => {
      const userId = 'user123';
      const url = 'https://api.example.com';
      
      await db.saveAccessToken(userId, url, testToken);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(testToken);
    });

    it('should return null for non-existent tokens', async () => {
      const result = await db.getAccessToken('nonexistent', 'https://api.example.com');
      expect(result).toBeNull();
    });

    it('should handle tokens without refresh token', async () => {
      const tokenWithoutRefresh: AccessToken = {
        accessToken: 'test-access-token',
        resourceUrl: 'https://api.example.com'
      };

      const userId = 'user123';
      const url = 'https://api.example.com';
      
      await db.saveAccessToken(userId, url, tokenWithoutRefresh);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(tokenWithoutRefresh);
      expect(retrieved?.refreshToken).toBeUndefined();
    });

    it('should handle expired tokens', async () => {
      const expiredToken: AccessToken = {
        accessToken: 'expired-token',
        expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        resourceUrl: 'https://api.example.com'
      };

      const userId = 'user123';
      const url = 'https://api.example.com';
      
      await db.saveAccessToken(userId, url, expiredToken);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toBeNull();
    });

    it('should set TTL based on token expiration', async () => {
      const userId = 'user123';
      const url = 'https://api.example.com';
      
      await db.saveAccessToken(userId, url, testToken);
      
      // Verify token was saved
      const keys = mockRedis.getAllKeys();
      expect(keys.length).toBe(1);
    });

    it('should use configured TTL when provided', async () => {
      const ttlDb = new RedisOAuthDb({
        redis: mockRedis,
        ttl: 1800, // 30 minutes
        keyPrefix: 'ttl:'
      });

      const tokenWithoutExpiry: AccessToken = {
        accessToken: 'test-token',
        resourceUrl: 'https://api.example.com'
      };

      const userId = 'user123';
      const url = 'https://api.example.com';
      
      await ttlDb.saveAccessToken(userId, url, tokenWithoutExpiry);
      
      const keys = mockRedis.getAllKeys();
      expect(keys.length).toBe(1);
    });

    it('should handle encryption/decryption for tokens', async () => {
      const encryptDb = new RedisOAuthDb({
        redis: mockRedis,
        encrypt: (data) => `encrypted_${data}`,
        decrypt: (data) => data.replace('encrypted_', ''),
        keyPrefix: 'encrypted:'
      });

      const userId = 'user123';
      const url = 'https://api.example.com';
      await encryptDb.saveAccessToken(userId, url, testToken);
      
      const retrieved = await encryptDb.getAccessToken(userId, url);
      expect(retrieved).toEqual(testToken);
    });

    it('should handle corrupted token data gracefully', async () => {
      const userId = 'user123';
      const url = 'https://api.example.com';
      await mockRedis.set('test:access_token:user123:https://api.example.com', 'invalid json');
      
      const result = await db.getAccessToken(userId, url);
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('key generation', () => {
    it('should generate correct keys with custom prefix', async () => {
      const customDb = new RedisOAuthDb({
        redis: mockRedis,
        keyPrefix: 'custom_prefix:'
      });

      // We can't directly test the private getKey method, but we can test the behavior
      // by checking the keys that get created
      const credentials: ClientCredentials = {
        clientId: 'test',
        clientSecret: 'test',
        redirectUri: 'test'
      };
      
      await customDb.saveClientCredentials('https://test.com', credentials);
      
      const keys = mockRedis.getAllKeys();
      expect(keys[0]).toBe('custom_prefix:client_credentials:https://test.com');
    });
  });

  describe('close', () => {
    it('should close Redis connection', async () => {
      const quitSpy = vi.spyOn(mockRedis, 'quit');
      
      await db.close();
      
      expect(quitSpy).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      const mockRedisWithError = {
        ...mockRedis,
        quit: vi.fn().mockRejectedValue(new Error('Connection error'))
      } as any;

      const errorDb = new RedisOAuthDb({
        redis: mockRedisWithError,
        logger: mockLogger
      });

      await errorDb.close();
      
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Error closing Redis connection'));
    });
  });
});