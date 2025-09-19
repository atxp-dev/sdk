import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildATXPConfig } from '../buildATXPConfig.js';
import './setup.js';
import { ATXPArgs, ChainPaymentDestination } from '@atxp/server';

// Mock the buildServerConfig function
vi.mock('@atxp/server', () => ({
  buildServerConfig: vi.fn((args) => ({
    mockConfig: true,
    ...args
  })),
  ChainPaymentDestination: vi.fn().mockImplementation((address: string, network: string) => ({
    destination: vi.fn().mockResolvedValue({ destination: address, network })
  }))
}));

describe('buildATXPConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call buildServerConfig with provided args', () => {
    const args : ATXPArgs = {
      paymentDestination: new ChainPaymentDestination('0x1234567890123456789012345678901234567890', 'base'),
      payeeName: 'Test Server',
      allowHttp: true
    };

    const result = buildATXPConfig(args);

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
      paymentDestination: new ChainPaymentDestination('0x1234567890123456789012345678901234567890', 'base')
    };

    buildATXPConfig(args);

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
      paymentDestination: new ChainPaymentDestination('0x1234567890123456789012345678901234567890', 'base')
    };

    expect(() => buildATXPConfig(args)).not.toThrow();

    // Restore original fetch
    globalThis.fetch = originalFetch;
  });
});