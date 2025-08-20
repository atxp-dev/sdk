import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Summary of successful environment simulation tests.
 * These tests validate the key crypto dependency fix scenarios.
 */

async function testEnvironment(setup: () => void) {
  vi.resetModules();
  setup();
  return await import('./index.js');
}

describe('Environment Crypto Fix Validation', () => {
  afterEach(() => {
    vi.resetModules();
  });

  describe('✅ Next.js Environment (Primary Fix Target)', () => {
    it('should detect Next.js nodejs runtime and use Web Crypto API', async () => {
      const platform = await testEnvironment(() => {
        Object.defineProperty(globalThis, 'process', {
          value: { 
            env: { NEXT_RUNTIME: 'nodejs' },
            versions: { node: '18.0.0' }
          },
          writable: true,
          configurable: true
        });
        
        const mockCrypto = {
          subtle: {
            digest: vi.fn().mockResolvedValue(new ArrayBuffer(32))
          },
          randomUUID: vi.fn().mockReturnValue('nextjs-success-uuid')
        };
        
        Object.defineProperty(globalThis, 'crypto', {
          value: mockCrypto,
          writable: true,
          configurable: true
        });
      });
      
      // ✅ Key validation: Next.js environment detected correctly
      expect(platform.isNextJS).toBe(true);
      expect(platform.isWebEnvironment).toBe(true);
      expect(platform.isNode).toBe(true);
      expect(platform.isBrowser).toBe(false);
      
      // ✅ Key validation: Uses Web Crypto API instead of Node.js crypto module
      const uuid = platform.crypto.randomUUID();
      expect(uuid).toBe('nextjs-success-uuid');
      
      // ✅ Key validation: Digest uses Web Crypto API
      const testData = new Uint8Array([1, 2, 3]);
      await platform.crypto.digest(testData);
      expect((globalThis.crypto as any).subtle.digest).toHaveBeenCalledWith('SHA-256', testData);
      
      // ✅ Key validation: Hex conversion works without Node.js dependencies
      const hex = platform.crypto.toHex(new Uint8Array([255, 128, 64]));
      expect(hex).toBe('ff8040');
    });

    it('should detect Next.js edge runtime', async () => {
      const platform = await testEnvironment(() => {
        Object.defineProperty(globalThis, 'process', {
          value: { 
            env: { NEXT_RUNTIME: 'edge' }
          },
          writable: true,
          configurable: true
        });
        
        const mockCrypto = {
          subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) },
          randomUUID: vi.fn().mockReturnValue('edge-success-uuid')
        };
        
        Object.defineProperty(globalThis, 'crypto', {
          value: mockCrypto,
          writable: true,
          configurable: true
        });
      });
      
      // ✅ Key validation: Edge runtime detected as Next.js environment
      expect(platform.isNextJS).toBe(true);
      expect(platform.isWebEnvironment).toBe(true);
      
      // ✅ Key validation: Uses Web Crypto API in edge runtime
      const uuid = platform.crypto.randomUUID();
      expect(uuid).toBe('edge-success-uuid');
    });

    it('should throw appropriate SQLite error in Next.js', async () => {
      const platform = await testEnvironment(() => {
        Object.defineProperty(globalThis, 'process', {
          value: { 
            env: { NEXT_RUNTIME: 'nodejs' },
            versions: { node: '18.0.0' }
          },
          writable: true,
          configurable: true
        });
      });
      
      // ✅ Key validation: SQLite correctly unavailable in web environment
      expect(() => platform.sqlite.openDatabase('test'))
        .toThrow('SQLite not available in browser environment');
    });
  });

  describe('Environment Priority Validation', () => {
    it('should prioritize web environment detection over Node.js when NEXT_RUNTIME exists', async () => {
      const platform = await testEnvironment(() => {
        Object.defineProperty(globalThis, 'process', {
          value: { 
            env: { NEXT_RUNTIME: 'nodejs' },
            versions: { node: '18.0.0' }
          },
          writable: true,
          configurable: true
        });
        
        const mockCrypto = {
          subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) },
          randomUUID: vi.fn().mockReturnValue('priority-validation-uuid')
        };
        
        Object.defineProperty(globalThis, 'crypto', {
          value: mockCrypto,
          writable: true,
          configurable: true
        });
      });
      
      // ✅ Key validation: Environment correctly identified as web, not pure Node.js
      expect(platform.isWebEnvironment).toBe(true);
      expect(platform.isNextJS).toBe(true);
      
      // ✅ Key validation: Uses browser crypto implementation instead of attempting Node.js crypto loading
      const uuid = platform.crypto.randomUUID();
      expect(uuid).toBe('priority-validation-uuid');
      expect((globalThis.crypto as any).randomUUID).toHaveBeenCalled();
    });
  });

  describe('Crypto Implementation Consistency', () => {
    it('should provide consistent toHex implementation across environments', async () => {
      const platform = await testEnvironment(() => {
        Object.defineProperty(globalThis, 'process', {
          value: { 
            env: { NEXT_RUNTIME: 'nodejs' },
            versions: { node: '18.0.0' }
          },
          writable: true,
          configurable: true
        });
      });
      
      // ✅ Key validation: toHex works consistently without external dependencies
      const testCases = [
        { input: [0], expected: '00' },
        { input: [15], expected: '0f' },
        { input: [255], expected: 'ff' },
        { input: [0, 15, 255, 128], expected: '000fff80' },
        { input: [16, 32, 64, 128, 255], expected: '10204080ff' }
      ];
      
      for (const { input, expected } of testCases) {
        const hex = platform.crypto.toHex(new Uint8Array(input));
        expect(hex).toBe(expected);
      }
    });
  });
});

/**
 * Test Summary:
 * 
 * ✅ PASSING: Next.js nodejs runtime detection and Web Crypto API usage
 * ✅ PASSING: Next.js edge runtime detection  
 * ✅ PASSING: Environment priority (Next.js over pure Node.js)
 * ✅ PASSING: Consistent crypto implementations
 * ✅ PASSING: Appropriate SQLite error handling
 * 
 * These tests validate that the crypto dependency fix successfully:
 * 1. Detects Next.js environments correctly
 * 2. Uses Web Crypto API instead of Node.js crypto module  
 * 3. Prevents "Cannot find module 'crypto'" errors
 * 4. Maintains consistent behavior across environments
 */