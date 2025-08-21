/* eslint-disable @typescript-eslint/no-explicit-any */
 

import type { FetchLike } from '../types.js';

// Platform abstraction layer
export interface PlatformCrypto {
  digest: (data: Uint8Array) => Promise<Uint8Array>;
  randomUUID: () => string;
  toHex: (data: Uint8Array) => string;
}


// Platform detection - supports both Expo and bare React Native
export function getIsReactNative() {
  const nav = (typeof navigator !== 'undefined' ? navigator : (typeof global !== 'undefined' ? (global as any).navigator : undefined));
  return !!nav && nav.product === 'ReactNative';
}
export const isNode = typeof process !== 'undefined' && !!process.versions?.node;
export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
export const isNextJS = typeof process !== 'undefined' && process.env.NEXT_RUNTIME !== undefined;
export const isWebEnvironment = isBrowser || isNextJS;

// Helper to load modules in both CommonJS and ESM environments
function loadModule(moduleId: string): any {
  try {
    // Try to use eval('require') to prevent bundler static analysis
    const requireFunc = (0, eval)('require');
    return requireFunc(moduleId);
  } catch {
    throw new Error(`Failed to load module "${moduleId}" synchronously. In ESM environments, please ensure the module is pre-loaded or use MemoryOAuthDb instead.`);
  }
}

// Async version for cases where we can fall back to dynamic import
async function loadModuleAsync(moduleId: string): Promise<any> {
  try {
    // Try synchronous loading first
    return loadModule(moduleId);
  } catch {
    // Fall back to dynamic import for ESM
    try {
      return await import(moduleId);
    } catch (e) {
      throw new Error(`Failed to load module "${moduleId}": ${e instanceof Error ? e.message : 'Module loading not available in this environment'}`);
    }
  }
}

// Apply URL polyfill for React Native/Expo
if (getIsReactNative()) {
  loadModule('react-native-url-polyfill/auto');
}

// React Native safe fetch that prevents body consumption issues
export const createReactNativeSafeFetch = (originalFetch: FetchLike): FetchLike => {
  return async (url, init) => {
    const response = await originalFetch(url, init);
    
    // For non-2xx responses or responses we know won't have JSON bodies, return as-is
    if (!response.ok || response.status === 204) {
      return response;
    }
    
    // Pre-read the body to avoid consumption issues
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const bodyText = await response.text();
        // Create a new Response with the pre-read body
        return new Response(bodyText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch {
        // If reading fails, return original response
        return response;
      }
    }
    
    return response;
  };
};

// Platform factory functions
function createReactNativeCrypto(): PlatformCrypto {
  let expoCrypto: any;
  try {
    expoCrypto = loadModule('expo-crypto');
  } catch {
    throw new Error(
      'React Native detected but expo-crypto package is required. ' +
      'Please install it: npm install expo-crypto'
    );
  }
  
  return {
    digest: async (data: Uint8Array) => {
      const hash = await expoCrypto.digestStringAsync(
        expoCrypto.CryptoDigestAlgorithm.SHA256,
        new TextDecoder().decode(data)
      );
      return new Uint8Array(Buffer.from(hash, 'hex'));
    },
    randomUUID: () => expoCrypto.randomUUID(),
    toHex: (data: Uint8Array) => Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(''),
  };
}


function createBrowserCrypto(): PlatformCrypto {
  return {
    digest: async (data: Uint8Array) => {
      if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
        const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(hashBuffer);
      }
      throw new Error('Web Crypto API not available in this browser environment');
    },
    randomUUID: () => {
      if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.randomUUID) {
        return globalThis.crypto.randomUUID();
      }
      // Fallback UUID generation for older browsers
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },
    toHex: (data: Uint8Array) => Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(''),
  };
}

function createNodeCrypto(): PlatformCrypto {
  let cryptoModule: any = null;
  
  return {
    digest: async (data: Uint8Array) => {
      if (!cryptoModule) {
        cryptoModule = await loadModuleAsync('crypto');
      }
      return new Uint8Array(cryptoModule.createHash('sha256').update(data).digest());
    },
    randomUUID: () => {
      // randomUUID is synchronous, so we need sync loading
      try {
        const crypto = loadModule('crypto');
        return crypto.randomUUID();
      } catch {
        throw new Error('randomUUID requires synchronous module loading (CommonJS)');
      }
    },
    toHex: (data: Uint8Array) => Buffer.from(data).toString('hex'),
  };
}


// Export platform-specific implementations
export let crypto: PlatformCrypto;

if (getIsReactNative()) {
  crypto = createReactNativeCrypto();
} else if (isWebEnvironment) {
  crypto = createBrowserCrypto();
} else {
  crypto = createNodeCrypto();
}

 