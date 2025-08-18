// Expo/React Native-specific tests for platform abstraction
// Only include tests relevant to cross-platform or Expo/React Native logic

import { describe, it, expect } from 'vitest';
import { getIsReactNative, crypto, sqlite } from './index.js';

describe('Platform Abstraction (Expo)', () => {
  it('should detect platform correctly', () => {
    // This should be true in React Native/Expo tests
    expect(typeof getIsReactNative()).toBe('boolean');
  });

  it('should have working crypto implementation', async () => {
    const testData = new TextEncoder().encode('test');
    const hash = await crypto.digest(testData);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBeGreaterThan(0);
  });

  it('should have working SQLite implementation', () => {
    const db = sqlite.openDatabase(':memory:');
    expect(db).toBeDefined();
    expect(typeof db.execAsync).toBe('function');
    expect(typeof db.prepareAsync).toBe('function');
  });

  it('should handle SQL queries correctly', async () => {
    const db = sqlite.openDatabase(':memory:');
    
    // Test CREATE TABLE
    await db.execAsync('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');

    // Test INSERT
    const stmt = await db.prepareAsync('INSERT INTO test (name) VALUES (?)');
    await stmt.executeAsync('test-name');
    await stmt.finalizeAsync();

    // Test SELECT
    const selectStmt = await db.prepareAsync('SELECT * FROM test WHERE name = ?');
    const row = await (await selectStmt.executeAsync('test-name')).getFirstAsync();
    await selectStmt.finalizeAsync();

    expect(row).not.toBeNull();
    expect(row?.name).toBe('test-name');

    await db.closeAsync();
  });
}); 