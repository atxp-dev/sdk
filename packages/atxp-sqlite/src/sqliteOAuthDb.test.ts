import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteOAuthDb } from './sqliteOAuthDb.js';
import type { AccessToken, ClientCredentials, PKCEValues } from '@atxp/common';

describe('SqliteOAuthDb', () => {
  let db: SqliteOAuthDb;

  beforeEach(async () => {
    // Use in-memory database for tests
    db = new SqliteOAuthDb({ db: ':memory:' });
    await db.ensureInitialized();
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
    });

    it('should return null for non-existent client credentials', async () => {
      const retrieved = await db.getClientCredentials('https://nonexistent.com');
      expect(retrieved).toBeNull();
    });

    it('should update existing client credentials', async () => {
      await db.saveClientCredentials(resourceUrl, credentials);
      
      const updatedCredentials: ClientCredentials = {
        clientId: 'updated-client-id',
        clientSecret: 'updated-client-secret',
        redirectUri: 'https://updated.com/callback'
      };
      
      await db.saveClientCredentials(resourceUrl, updatedCredentials);
      const retrieved = await db.getClientCredentials(resourceUrl);
      
      expect(retrieved).toEqual(updatedCredentials);
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

    it('should handle multiple PKCE values for different users/states', async () => {
      const pkceValues2: PKCEValues = {
        codeVerifier: 'different-verifier',
        codeChallenge: 'different-challenge',
        resourceUrl: 'https://other.com',
        url: 'https://other.com/oauth'
      };

      await db.savePKCEValues(userId, state, pkceValues);
      await db.savePKCEValues('other-user', state, pkceValues2);
      
      const retrieved1 = await db.getPKCEValues(userId, state);
      const retrieved2 = await db.getPKCEValues('other-user', state);
      
      expect(retrieved1).toEqual(pkceValues);
      expect(retrieved2).toEqual(pkceValues2);
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

    it('should handle access tokens without refresh tokens', async () => {
      const tokenWithoutRefresh: AccessToken = {
        accessToken: 'test-access-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        resourceUrl: 'https://example.com'
      };

      await db.saveAccessToken(userId, url, tokenWithoutRefresh);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(tokenWithoutRefresh);
      expect(retrieved?.refreshToken).toBeUndefined();
    });

    it('should handle access tokens without expiration', async () => {
      const tokenWithoutExpiry: AccessToken = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        resourceUrl: 'https://example.com'
      };

      await db.saveAccessToken(userId, url, tokenWithoutExpiry);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(tokenWithoutExpiry);
      expect(retrieved?.expiresAt).toBeUndefined();
    });

    it('should update existing access tokens', async () => {
      await db.saveAccessToken(userId, url, accessToken);
      
      const updatedToken: AccessToken = {
        accessToken: 'updated-access-token',
        refreshToken: 'updated-refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
        resourceUrl: 'https://updated.com'
      };
      
      await db.saveAccessToken(userId, url, updatedToken);
      const retrieved = await db.getAccessToken(userId, url);
      
      expect(retrieved).toEqual(updatedToken);
    });

    it('should handle multiple access tokens for different users/urls', async () => {
      const token2: AccessToken = {
        accessToken: 'different-access-token',
        resourceUrl: 'https://other.com'
      };

      await db.saveAccessToken(userId, url, accessToken);
      await db.saveAccessToken('other-user', 'https://other.com', token2);
      
      const retrieved1 = await db.getAccessToken(userId, url);
      const retrieved2 = await db.getAccessToken('other-user', 'https://other.com');
      
      expect(retrieved1).toEqual(accessToken);
      expect(retrieved2).toEqual(token2);
    });
  });

  describe('Encryption Support', () => {
    it('should support custom encryption/decryption functions', async () => {
      const encryptedDb = new SqliteOAuthDb({
        db: ':memory:',
        encrypt: (data: string) => Buffer.from(data).toString('base64'),
        decrypt: (data: string) => Buffer.from(data, 'base64').toString()
      });

      await encryptedDb.ensureInitialized();

      try {
        const credentials: ClientCredentials = {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          redirectUri: 'https://example.com/callback'
        };

        await encryptedDb.saveClientCredentials('https://example.com', credentials);
        const retrieved = await encryptedDb.getClientCredentials('https://example.com');

        expect(retrieved).toEqual(credentials);
      } finally {
        await encryptedDb.close();
      }
    });
  });

  describe('Database Schema', () => {
    it('should create all required tables on initialization', async () => {
      // This is implicitly tested by all the CRUD operations working
      // but we can verify the database is functional
      const testCredentials: ClientCredentials = {
        clientId: 'schema-test-client',
        clientSecret: 'schema-test-secret',
        redirectUri: 'https://test.com/callback'
      };

      const testPKCE: PKCEValues = {
        codeVerifier: 'schema-test-verifier',
        codeChallenge: 'schema-test-challenge',
        resourceUrl: 'https://test.com',
        url: 'https://test.com/oauth'
      };

      const testToken: AccessToken = {
        accessToken: 'schema-test-token',
        resourceUrl: 'https://test.com'
      };

      // Should be able to perform all operations without errors
      await db.saveClientCredentials('https://test.com', testCredentials);
      await db.savePKCEValues('schema-user', 'schema-state', testPKCE);
      await db.saveAccessToken('schema-user', 'https://test.com', testToken);

      const retrievedCredentials = await db.getClientCredentials('https://test.com');
      const retrievedPKCE = await db.getPKCEValues('schema-user', 'schema-state');
      const retrievedToken = await db.getAccessToken('schema-user', 'https://test.com');

      expect(retrievedCredentials).toEqual(testCredentials);
      expect(retrievedPKCE).toEqual(testPKCE);
      expect(retrievedToken).toEqual(testToken);
    });
  });

  describe('Error Handling', () => {
    it('should handle database close gracefully', async () => {
      await db.close();
      
      // Second close should not throw
      await expect(db.close()).resolves.not.toThrow();
    });

    it('should initialize database tables only once', async () => {
      // Call initialize multiple times
      await db.ensureInitialized();
      await db.ensureInitialized();
      await db.ensureInitialized();
      
      // Should still work normally
      const credentials: ClientCredentials = {
        clientId: 'multi-init-test',
        clientSecret: 'multi-init-secret',
        redirectUri: 'https://test.com/callback'
      };
      
      await db.saveClientCredentials('https://test.com', credentials);
      const retrieved = await db.getClientCredentials('https://test.com');
      
      expect(retrieved).toEqual(credentials);
    });
  });

  describe('Default Configuration', () => {
    it('should use default database path when none provided', () => {
      const defaultPath = SqliteOAuthDb.getDefaultDbPath();
      expect(defaultPath).toBe('oauthClient.db');
    });

    it('should work with default configuration', async () => {
      const defaultDb = new SqliteOAuthDb({ db: ':memory:' });
      await defaultDb.ensureInitialized();
      
      try {
        const credentials: ClientCredentials = {
          clientId: 'default-test-client',
          clientSecret: 'default-test-secret',
          redirectUri: 'https://default.com/callback'
        };

        await defaultDb.saveClientCredentials('https://default.com', credentials);
        const retrieved = await defaultDb.getClientCredentials('https://default.com');

        expect(retrieved).toEqual(credentials);
      } finally {
        await defaultDb.close();
      }
    });
  });
});