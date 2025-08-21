// Minimal Expo test setup 
import { vi } from 'vitest';

// Set test environment
process.env.NODE_ENV = 'test';

// Skip React Native navigator setup for now - causes syntax errors

// Mock Expo modules
vi.mock('expo-crypto', () => ({
  digestStringAsync: vi.fn(async (algorithm: string, data: string) => {
    // Simple mock implementation that returns a hex string
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = new Uint8Array(32); // SHA256 is 32 bytes
    // Simple hash simulation - just use the first 32 bytes of the input
    for (let i = 0; i < Math.min(32, dataBuffer.length); i++) {
      hashBuffer[i] = dataBuffer[i];
    }
    return Array.from(hashBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
  }),
  CryptoDigestAlgorithm: {
    SHA256: 'SHA256',
  },
  randomUUID: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

vi.mock('react-native-url-polyfill', () => ({
  URL: global.URL,
}));

vi.mock('react-native-url-polyfill/auto', () => ({}));

// Set up test environment
process.env.NODE_ENV = 'test'; 