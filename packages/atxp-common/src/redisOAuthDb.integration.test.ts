import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RedisOAuthDb } from './index.js';
import type { AccessToken, ClientCredentials, PKCEValues } from './types.js';

const REDIS_URL = process.env.REDIS_URL;

// Only run these tests if REDIS_URL is provided
describe.skipIf(!REDIS_URL)('RedisOAuthDb Integration Tests', () => {
  let db: RedisOAuthDb;
  const testKeyPrefix = `test:${Date.now()}:`;

  beforeEach(async () => {
    if (!REDIS_URL) return;
    
    db = new RedisOAuthDb({
      redis: REDIS_URL,
      keyPrefix: testKeyPrefix,
      ttl: 60 // Short TTL for tests
    });
    
    // Wait for Redis connection to be established with timeout
    // Try a simple operation to ensure connection is ready
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 2000)
      );
      
      await Promise.race([
        db.getClientCredentials('connection-test'),
        timeoutPromise
      ]);
    } catch (error) {
      // If connection fails, skip the tests by throwing
      throw new Error(`Redis connection failed: ${error}. Please ensure Redis is running at ${REDIS_URL}`);
    }
  }, 5000); // 5 second timeout for beforeEach

  afterEach(async () => {
    if (!db) return;
    
    // Clean up all test keys
    try {
      const redis = await (db as any).getRedisClient();
      const keys = await redis.keys(`${testKeyPrefix}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await db.close();
    } catch (error) {
      console.warn('Error cleaning up Redis test data:', error);
    }
  });

  describe('Client Credentials', () => {
    it('should save and retrieve client credentials from real Redis', async () => {
      const resourceUrl = 'https://api.example.com';
      const credentials: ClientCredentials = {
        clientId: 'integration-test-client-id',
        clientSecret: 'integration-test-client-secret',
        redirectUri: 'https://example.com/callback'
      };

      await db.saveClientCredentials(resourceUrl, credentials);
      const retrieved = await db.getClientCredentials(resourceUrl);
      
      expect(retrieved).toEqual(credentials);
    });

    it('should return null for non-existent credentials', async () => {
      const result = await db.getClientCredentials('https://nonexistent-integration-test.com');
      expect(result).toBeNull();
    });
  });

  describe('PKCE Values', () => {
    it('should save and retrieve PKCE values from real Redis', async () => {
      const userId = 'integration-test-user';
      const state = 'integration-test-state';
      const pkceValues: PKCEValues = {
        codeVerifier: 'integration-test-code-verifier',
        codeChallenge: 'integration-test-code-challenge',
        resourceUrl: 'https://auth.example.com',
        url: 'https://api.example.com'
      };

      await db.savePKCEValues(userId, state, pkceValues);
      const retrieved = await db.getPKCEValues(userId, state);
      
      expect(retrieved).toEqual(pkceValues);
    });

    it('should automatically expire PKCE values', async () => {
      const userId = 'integration-test-user-expire';
      const state = 'integration-test-state-expire';
      const pkceValues: PKCEValues = {
        codeVerifier: 'expire-test-code-verifier',
        codeChallenge: 'expire-test-code-challenge',
        resourceUrl: 'https://auth.example.com',
        url: 'https://api.example.com'
      };

      await db.savePKCEValues(userId, state, pkceValues);
      
      // Verify it exists immediately
      const retrieved = await db.getPKCEValues(userId, state);
      expect(retrieved).toEqual(pkceValues);
      
      // Check TTL is set (PKCE values should have 10 minute TTL)
      const redis = await (db as any).getRedisClient();
      const key = `${testKeyPrefix}pkce:${userId}:${state}`;
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600); // 10 minutes
    });
  });

  describe('Access Tokens', () => {
    it('should save and retrieve access tokens from real Redis', async () => {
      const userId = 'integration-test-user';
      const url = 'https://api.example.com';
      const token: AccessToken = {
        accessToken: 'integration-test-access-token',
        refreshToken: 'integration-test-refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        resourceUrl: 'https://api.example.com'
      };

      await db.saveAccessToken(userId, url, token);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(token);
    });

    it('should handle tokens without refresh tokens', async () => {
      const userId = 'integration-test-user-no-refresh';
      const url = 'https://api.example.com';
      const token: AccessToken = {
        accessToken: 'integration-test-access-token-no-refresh',
        resourceUrl: 'https://api.example.com'
      };

      await db.saveAccessToken(userId, url, token);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(token);
      expect(retrieved?.refreshToken).toBeUndefined();
    });

    it('should respect token expiration times', async () => {
      const userId = 'integration-test-user-expired';
      const url = 'https://api.example.com';
      const expiredToken: AccessToken = {
        accessToken: 'integration-test-expired-token',
        expiresAt: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago
        resourceUrl: 'https://api.example.com'
      };

      await db.saveAccessToken(userId, url, expiredToken);
      const retrieved = await db.getAccessToken(userId, url);
      
      // Should return null because token is expired
      expect(retrieved).toBeNull();
    });

    it('should set TTL based on configured value', async () => {
      const dbWithTTL = new RedisOAuthDb({
        redis: REDIS_URL!,
        keyPrefix: testKeyPrefix,
        ttl: 30 // 30 seconds
      });

      const userId = 'integration-test-user-ttl';
      const url = 'https://api.example.com';
      const token: AccessToken = {
        accessToken: 'integration-test-ttl-token',
        resourceUrl: 'https://api.example.com'
      };

      await dbWithTTL.saveAccessToken(userId, url, token);
      
      // Check TTL is set correctly
      const redis = await (dbWithTTL as any).getRedisClient();
      const key = `${testKeyPrefix}access_token:${userId}:${url}`;
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
      
      await dbWithTTL.close();
    });
  });

  describe('Encryption Support', () => {
    it('should handle encryption and decryption with real Redis', async () => {
      const encryptedDb = new RedisOAuthDb({
        redis: REDIS_URL!,
        keyPrefix: testKeyPrefix,
        encrypt: (data: string) => `encrypted:${Buffer.from(data).toString('base64')}`,
        decrypt: (data: string) => Buffer.from(data.replace('encrypted:', ''), 'base64').toString()
      });

      const credentials: ClientCredentials = {
        clientId: 'encryption-test-client',
        clientSecret: 'encryption-test-secret',
        redirectUri: 'https://example.com/callback'
      };

      await encryptedDb.saveClientCredentials('https://encryption-test.com', credentials);
      
      // Verify data is encrypted in Redis
      const redis = await (encryptedDb as any).getRedisClient();
      const key = `${testKeyPrefix}client_credentials:https://encryption-test.com`;
      const rawData = await redis.get(key);
      expect(rawData).toContain('encrypted:');
      
      // Verify decryption works
      const retrieved = await encryptedDb.getClientCredentials('https://encryption-test.com');
      expect(retrieved).toEqual(credentials);
      
      await encryptedDb.close();
    });
  });

  describe('Data Persistence', () => {
    it('should persist data across database instances', async () => {
      // Create first instance and save data
      const db1 = new RedisOAuthDb({
        redis: REDIS_URL!,
        keyPrefix: `persistence-test:${Date.now()}:`
      });
      
      const credentials: ClientCredentials = {
        clientId: 'persistence-test-client',
        clientSecret: 'persistence-test-secret', 
        redirectUri: 'https://example.com/callback'
      };
      
      await db1.saveClientCredentials('https://persistence-test.com', credentials);
      await db1.close();
      
      // Create second instance and retrieve data
      const db2 = new RedisOAuthDb({
        redis: REDIS_URL!,
        keyPrefix: `persistence-test:${Date.now()}:`
      });
      
      // Should not find data with different prefix (isolation test)
      const notFound = await db2.getClientCredentials('https://persistence-test.com');
      expect(notFound).toBeNull();
      
      // Create third instance with same prefix as first
      const db3 = new RedisOAuthDb({
        redis: REDIS_URL!,
        keyPrefix: db1['keyPrefix'] // Access the same prefix
      });
      
      const retrieved = await db3.getClientCredentials('https://persistence-test.com');
      expect(retrieved).toEqual(credentials);
      
      await db3.close();
    });
  });
});

// Show message when integration tests are skipped
if (!REDIS_URL) {
  console.log('\n📝 Redis integration tests skipped. To run them, set the REDIS_URL environment variable.');
  console.log('   Example: REDIS_URL=redis://localhost:6379 npm test\n');
}