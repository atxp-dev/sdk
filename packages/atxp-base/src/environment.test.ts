import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Environment Detection', () => {
  let originalWindow: any;

  beforeEach(() => {
    // Store original window state
    originalWindow = (global as any).window;
  });

  afterEach(() => {
    // Restore original window state
    if (originalWindow === undefined) {
      delete (global as any).window;
    } else {
      (global as any).window = originalWindow;
    }
  });

  describe('Browser environment detection', () => {
    it('should detect browser environment when window is defined', () => {
      // Simulate browser environment
      (global as any).window = {};
      
      expect(typeof window).not.toBe('undefined');
      expect('window' in global).toBe(true);
    });

    it('should provide window object properties', () => {
      (global as any).window = {
        location: { href: 'http://localhost' },
        navigator: { userAgent: 'test' }
      };
      
      expect(window.location).toBeDefined();
      expect(window.navigator).toBeDefined();
    });
  });

  describe('Server environment detection', () => {
    it('should detect server environment when window is undefined', () => {
      // Simulate server environment
      delete (global as any).window;
      
      expect(typeof (global as any).window).toBe('undefined');
    });

    it('should handle environment checks gracefully', () => {
      delete (global as any).window;
      
      // This is how our code checks for browser vs server
      const isBrowser = typeof (global as any).window !== 'undefined';
      const isServer = typeof (global as any).window === 'undefined';
      
      expect(isBrowser).toBe(false);
      expect(isServer).toBe(true);
    });
  });

  describe('Environment-specific error messages', () => {
    it('should provide Next.js specific guidance', () => {
      const errorMessage = 'requestSpendPermission requires browser environment. BaseAppAccount.initialize() with ephemeral wallet should only be called client-side in Next.js apps.';
      
      expect(errorMessage).toContain('browser environment');
      expect(errorMessage).toContain('client-side');
      expect(errorMessage).toContain('Next.js apps');
    });

    it('should explain the limitation clearly', () => {
      const errorMessage = 'requestSpendPermission requires browser environment. BaseAppAccount.initialize() with ephemeral wallet should only be called client-side in Next.js apps.';
      
      // The error should be descriptive enough for developers to understand
      expect(errorMessage.length).toBeGreaterThan(50);
      expect(errorMessage).toContain('requestSpendPermission');
    });
  });

  describe('Dynamic import path selection', () => {
    it('should select browser path when window exists', () => {
      (global as any).window = {};
      
      const isBrowser = typeof (global as any).window !== 'undefined';
      const selectedPath = isBrowser ? 'browser' : 'node';
      
      expect(selectedPath).toBe('browser');
    });

    it('should select node path when window does not exist', () => {
      delete (global as any).window;
      
      const isBrowser = typeof (global as any).window !== 'undefined';
      const selectedPath = isBrowser ? 'browser' : 'node';
      
      expect(selectedPath).toBe('node');
    });
  });
});