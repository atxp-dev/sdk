// Expo/React Native-specific tests for platform abstraction
// Only include tests relevant to cross-platform or Expo/React Native logic

import { describe, it, expect } from 'vitest';
import { crypto } from '@atxp/common';

describe('Platform Crypto (Expo)', () => {
  it('should generate consistent hashes', async () => {
    const testData = new TextEncoder().encode('test');
    const hash1 = await crypto.digest(testData);
    const hash2 = await crypto.digest(testData);
    expect(hash1).toEqual(hash2);
  });

  it('should generate different hashes for different data', async () => {
    const data1 = new TextEncoder().encode('test1');
    const data2 = new TextEncoder().encode('test2');
    const hash1 = await crypto.digest(data1);
    const hash2 = await crypto.digest(data2);
    expect(hash1).not.toEqual(hash2);
  });

  it('should convert to hex correctly', () => {
    const testData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const hex = crypto.toHex(testData);
    expect(hex).toBe('01020304');
  });
}); 