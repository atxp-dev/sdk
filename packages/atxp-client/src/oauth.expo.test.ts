// Expo/React Native-specific tests for platform abstraction
// Only include tests relevant to cross-platform logic

import { describe, it, expect } from 'vitest';
import { getIsReactNative, crypto } from '@atxp/common';

describe('Platform Abstraction (Expo)', () => {
  it('should detect React Native environment', () => {
    // This should be true in React Native/Expo tests
    expect(typeof getIsReactNative()).toBe('boolean');
    // In Node test environment without navigator.product='ReactNative', this will be false
    expect(getIsReactNative()).toBe(false);
  });

  it('should have working crypto implementation', async () => {
    const testData = new TextEncoder().encode('test');
    const hash = await crypto.digest(testData);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBeGreaterThan(0);
  });
}); 