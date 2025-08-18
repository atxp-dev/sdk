// Expo/React Native-specific tests for platform abstraction
// Only include tests relevant to cross-platform or Expo/React Native logic

import { describe, it, expect } from 'vitest';
import { sqlite } from './index.js';

describe('Platform SQLite (Expo)', () => {
  it('should handle SQL queries correctly', async () => {
    const db = sqlite.openDatabase(':memory:');
    
    // Test CREATE TABLE
    await db.execAsync(`
      CREATE TABLE test (
        id INTEGER PRIMARY KEY,
        name TEXT
      )
    `);

    // Test INSERT
    const insertStmt = await db.prepareAsync('INSERT INTO test (name) VALUES (?)');
    await insertStmt.executeAsync('test-name');
    await insertStmt.finalizeAsync();

    // Test SELECT
    const selectStmt = await db.prepareAsync('SELECT * FROM test WHERE name = ?');
    const result = await selectStmt.executeAsync('test-name');
    const row = await result.getFirstAsync();
    await selectStmt.finalizeAsync();

    expect(row).not.toBeNull();
    expect(row?.name).toBe('test-name');

    await db.closeAsync();
  });
}); 