// Expo/React Native-specific tests for platform abstraction
// Only include tests relevant to cross-platform or Expo/React Native logic

import { describe, it, expect } from 'vitest';
import { SqliteOAuthDb } from './oAuthDb.js';

describe('SqliteOAuthDb (Expo)', () => {
  it('can be imported and instantiated without error', () => {
    expect(() => {
      new SqliteOAuthDb();
    }).not.toThrow();
  });

  it('platform detection should work in test environment', async () => {
    // Test that platform detection is accessible through the main exports
    const { getIsReactNative } = await import('./platform/index.js');
    expect(typeof getIsReactNative).toBe('function');
    
    // In Node test environment, this should return false
    expect(getIsReactNative()).toBe(false);
  });
}); 