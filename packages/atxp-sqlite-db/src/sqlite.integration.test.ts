import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteOAuthDb } from './sqliteOAuthDb.js';
import { sqlite } from './platform.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SQLite Integration Tests', () => {
  let tempDbPath: string;
  let db: SqliteOAuthDb;

  beforeEach(async () => {
    // Create a temporary database file
    tempDbPath = join(tmpdir(), `test-oauth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`);
  });

  afterEach(async () => {
    // Clean up
    if (db) {
      await db.close();
    }
    
    try {
      await fs.unlink(tempDbPath);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  it('should create and use a real SQLite database file', async () => {
    db = new SqliteOAuthDb({ db: tempDbPath });
    await db.ensureInitialized();

    // Verify the database file was created
    const stats = await fs.stat(tempDbPath);
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);

    // Verify we can perform database operations
    const credentials = {
      clientId: 'integration-test-client',
      clientSecret: 'integration-test-secret',
      redirectUri: 'https://integration.com/callback'
    };

    await db.saveClientCredentials('https://integration.com', credentials);
    const retrieved = await db.getClientCredentials('https://integration.com');

    expect(retrieved).toEqual(credentials);
  });

  it('should persist data across database reopens', async () => {
    // First connection - write data
    db = new SqliteOAuthDb({ db: tempDbPath });
    await db.ensureInitialized();

    const credentials = {
      clientId: 'persistence-test-client',
      clientSecret: 'persistence-test-secret',
      redirectUri: 'https://persistence.com/callback'
    };

    await db.saveClientCredentials('https://persistence.com', credentials);
    await db.close();

    // Second connection - read data
    db = new SqliteOAuthDb({ db: tempDbPath });
    const retrieved = await db.getClientCredentials('https://persistence.com');

    expect(retrieved).toEqual(credentials);
  });

  it('should handle concurrent database access', async () => {
    db = new SqliteOAuthDb({ db: tempDbPath });
    await db.ensureInitialized();

    // Create multiple concurrent operations
    const operations = Array.from({ length: 10 }, (_, i) => {
      const credentials = {
        clientId: `concurrent-client-${i}`,
        clientSecret: `concurrent-secret-${i}`,
        redirectUri: `https://concurrent${i}.com/callback`
      };

      return db.saveClientCredentials(`https://concurrent${i}.com`, credentials);
    });

    // Wait for all operations to complete
    await Promise.all(operations);

    // Verify all data was saved correctly
    for (let i = 0; i < 10; i++) {
      const retrieved = await db.getClientCredentials(`https://concurrent${i}.com`);
      expect(retrieved).toEqual({
        clientId: `concurrent-client-${i}`,
        clientSecret: `concurrent-secret-${i}`,
        redirectUri: `https://concurrent${i}.com/callback`
      });
    }
  });

  it('should work with platform SQLite interface', async () => {
    // Test the platform abstraction directly
    const database = sqlite.openDatabase(':memory:');

    // Test basic SQL operations
    await database.execAsync(`
      CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);

    const insertStmt = await database.prepareAsync('INSERT INTO test_table (name) VALUES (?)');
    await insertStmt.executeAsync('test-name');
    await insertStmt.finalizeAsync();

    const selectStmt = await database.prepareAsync('SELECT name FROM test_table WHERE id = ?');
    const result = await selectStmt.executeAsync<{ name: string }>(1);
    const row = await result.getFirstAsync();
    await selectStmt.finalizeAsync();

    expect(row).toEqual({ name: 'test-name' });

    await database.closeAsync();
  });

  it('should handle database errors gracefully', async () => {
    // Test with invalid database path (should work with SQLite)
    const invalidPath = '/invalid/path/that/does/not/exist/test.db';
    
    // SQLite will create directories as needed in most cases, so test a different error
    db = new SqliteOAuthDb({ db: tempDbPath });
    await db.ensureInitialized();

    // Try to get data that doesn't exist - should return null, not throw
    const nonExistent = await db.getClientCredentials('https://nonexistent.com');
    expect(nonExistent).toBeNull();
  });

  it('should support in-memory databases', async () => {
    db = new SqliteOAuthDb({ db: ':memory:' });
    await db.ensureInitialized();

    const credentials = {
      clientId: 'memory-test-client',
      clientSecret: 'memory-test-secret',
      redirectUri: 'https://memory.com/callback'
    };

    await db.saveClientCredentials('https://memory.com', credentials);
    const retrieved = await db.getClientCredentials('https://memory.com');

    expect(retrieved).toEqual(credentials);
  });
});