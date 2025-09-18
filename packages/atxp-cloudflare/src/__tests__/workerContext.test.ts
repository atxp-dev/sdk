import { describe, it, expect, beforeEach } from 'vitest';
import {
  setATXPWorkerContext,
  getATXPWorkerContext,
} from '../workerContext.js';
import './setup.js';
import { TokenCheck } from '@atxp/server';

describe('workerContext', () => {
  beforeEach(() => {
    // Reset context before each test
    setATXPWorkerContext({} as any, new URL('https://example.com'));
  });

  describe('setATXPWorkerContext and getATXPWorkerContext', () => {
    it('should set and get worker context', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;
      const mockTokenCheck = {
        token: 'test-token',
        data: { sub: 'test-user', active: true }
      } as TokenCheck;

      setATXPWorkerContext(mockConfig, new URL('https://example.com'), mockTokenCheck);

      const context = getATXPWorkerContext();
      expect(context).toEqual({
        tokenCheck: mockTokenCheck,
        resource: new URL('https://example.com'),
        config: mockConfig
      });
    });

    it('should handle missing token check', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;

      setATXPWorkerContext(mockConfig, new URL('https://example.com'));

      const context = getATXPWorkerContext();
      expect(context).toEqual({
        tokenCheck: null,
        resource: new URL('https://example.com'),
        config: mockConfig
      });
    });
  });

  describe('getATXPConfig', () => {
    it('should return config from context', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;
      setATXPWorkerContext(mockConfig, new URL('https://example.com'));

      const config = getATXPWorkerContext()?.config;
      expect(config).toBe(mockConfig);
    });

    it('should return null when no context exists', () => {
      setATXPWorkerContext({} as any, new URL('https://example.com'));
      // Clear the context by setting it to null internally
      (setATXPWorkerContext as any)(null);

      const config = getATXPWorkerContext()?.config;
      expect(config).toBe(null);
    });
  });
});