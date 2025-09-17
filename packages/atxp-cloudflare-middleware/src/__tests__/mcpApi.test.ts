import { describe, it, expect, beforeEach } from 'vitest';
import { ATXPMcpApi } from '../mcpApi.js';
import './setup.js';

describe('ATXPMcpApi', () => {
  beforeEach(() => {
    ATXPMcpApi.reset();
  });

  describe('init', () => {
    it('should initialize ATXP middleware with valid config', () => {
      expect(() => ATXPMcpApi.init({
        fundingDestination: '0x1234567890123456789012345678901234567890',
        fundingNetwork: 'base'
      })).not.toThrow();

      expect(ATXPMcpApi.isInitialized()).toBe(true);
    });

    it('should throw error when fundingDestination is missing', () => {
      expect(() => ATXPMcpApi.init({
        fundingDestination: '',
        fundingNetwork: 'base'
      })).toThrow('fundingDestination is required for ATXP initialization');
    });

    it('should throw error when fundingNetwork is missing', () => {
      expect(() => ATXPMcpApi.init({
        fundingDestination: '0x1234567890123456789012345678901234567890',
        fundingNetwork: '' as any
      })).toThrow('fundingNetwork is required for ATXP initialization');
    });
  });

  describe('getMiddleware', () => {
    it('should return middleware after initialization', () => {
      ATXPMcpApi.init({
        fundingDestination: '0x1234567890123456789012345678901234567890',
        fundingNetwork: 'base'
      });

      const middleware = ATXPMcpApi.getMiddleware();
      expect(middleware).toBeDefined();
    });

    it('should throw error when not initialized', () => {
      expect(() => ATXPMcpApi.getMiddleware()).toThrow('ATXP not initialized - call ATXPMcpApi.init() first');
    });
  });

  describe('getConfig', () => {
    it('should return config after initialization', () => {
      ATXPMcpApi.init({
        fundingDestination: '0x1234567890123456789012345678901234567890',
        fundingNetwork: 'base'
      });

      const config = ATXPMcpApi.getConfig();
      expect(config).toBeDefined();
    });

    it('should throw error when not initialized', () => {
      expect(() => ATXPMcpApi.getConfig()).toThrow('ATXP not initialized - call ATXPMcpApi.init() first');
    });
  });

  describe('createOAuthMetadata', () => {
    it('should create OAuth metadata response', () => {
      const response = ATXPMcpApi.createOAuthMetadata('https://example.com/', 'Test Server');
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should use default resource name if not provided', () => {
      const response = ATXPMcpApi.createOAuthMetadata('https://example.com/');
      expect(response).toBeInstanceOf(Response);
    });
  });

  describe('createAuthContext', () => {
    it('should return empty context when no worker context exists', () => {
      const context = ATXPMcpApi.createAuthContext();
      expect(context).toEqual({});
    });
  });

  describe('reset', () => {
    it('should reset initialization state', () => {
      ATXPMcpApi.init({
        fundingDestination: '0x1234567890123456789012345678901234567890',
        fundingNetwork: 'base'
      });

      expect(ATXPMcpApi.isInitialized()).toBe(true);

      ATXPMcpApi.reset();

      expect(ATXPMcpApi.isInitialized()).toBe(false);
    });
  });
});