// Platform abstraction tests
// Only include tests relevant to cross-platform logic

import { describe, it, expect } from 'vitest';

describe('Platform abstraction', () => {
  it('platform detection should work in test environment', async () => {
    // Test that platform detection is accessible through the main exports
    const { getIsReactNative } = await import('./platform/index.js');
    expect(typeof getIsReactNative).toBe('function');
    
    // In Node test environment, this should return false
    expect(getIsReactNative()).toBe(false);
  });
}); 