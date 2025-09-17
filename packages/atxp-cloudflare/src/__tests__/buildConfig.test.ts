import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildWorkerATXPConfig } from '../buildConfig.js';
import './setup.js';

// Mock the buildServerConfig function
vi.mock('@atxp/server', () => ({
  buildServerConfig: vi.fn((args) => ({
    mockConfig: true,
    ...args
  }))
}));

describe('buildWorkerATXPConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call buildServerConfig with provided args', () => {
    const args = {
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base' as const,
      payeeName: 'Test Server',
      allowHttp: true
    };

    const result = buildWorkerATXPConfig(args);

    expect(result).toEqual({
      mockConfig: true,
      ...args
    });
  });

  it('should handle global fetch binding for Cloudflare Workers', () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const args = {
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base' as const
    };

    buildWorkerATXPConfig(args);

    // Verify that fetch is defined on globalThis (it may be bound)
    expect(globalThis.fetch).toBeDefined();
    expect(typeof globalThis.fetch).toBe('function');

    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  it('should work when global fetch is undefined', () => {
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = undefined;

    const args = {
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base' as const
    };

    expect(() => buildWorkerATXPConfig(args)).not.toThrow();

    // Restore original fetch
    globalThis.fetch = originalFetch;
  });
});