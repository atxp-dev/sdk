import { describe, it, expect, beforeEach } from 'vitest';
import {
  setATXPWorkerContext,
  getATXPWorkerContext,
  getATXPConfig,
  atxpAccountId
} from '../workerContext.js';
import './setup.js';
import { TokenCheck } from '@atxp/server';

describe('workerContext', () => {
  beforeEach(() => {
    // Reset context before each test
    setATXPWorkerContext({} as any);
  });

  describe('setATXPWorkerContext and getATXPWorkerContext', () => {
    it('should set and get worker context', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;
      const mockTokenCheck = {
        token: 'test-token',
        data: { sub: 'test-user', active: true }
      } as TokenCheck;

      setATXPWorkerContext(mockConfig, mockTokenCheck);

      const context = getATXPWorkerContext();
      expect(context).toEqual({
        userToken: 'test-token',
        tokenData: { sub: 'test-user', active: true },
        config: mockConfig
      });
    });

    it('should handle missing token check', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;

      setATXPWorkerContext(mockConfig);

      const context = getATXPWorkerContext();
      expect(context).toEqual({
        userToken: null,
        tokenData: null,
        config: mockConfig
      });
    });
  });

  describe('getATXPConfig', () => {
    it('should return config from context', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;
      setATXPWorkerContext(mockConfig);

      const config = getATXPConfig();
      expect(config).toBe(mockConfig);
    });

    it('should return null when no context exists', () => {
      setATXPWorkerContext({} as any);
      // Clear the context by setting it to null internally
      (setATXPWorkerContext as any)(null);

      const config = getATXPConfig();
      expect(config).toBe(null);
    });
  });

  describe('atxpAccountId', () => {
    it('should return account ID from token data', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;
      const mockTokenCheck = {
        token: 'test-token',
        data: { sub: 'test-user-id', active: true }
      } as TokenCheck;

      setATXPWorkerContext(mockConfig, mockTokenCheck);

      const accountId = atxpAccountId();
      expect(accountId).toBe('test-user-id');
    });

    it('should return null when no token data exists', () => {
      const mockConfig = { logger: { debug: () => {} } } as any;
      setATXPWorkerContext(mockConfig);

      const accountId = atxpAccountId();
      expect(accountId).toBe(null);
    });

    it('should return null when no context exists', () => {
      const accountId = atxpAccountId();
      expect(accountId).toBe(null);
    });
  });
});