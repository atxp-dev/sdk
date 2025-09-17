import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requirePayment } from '../requirePayment.js';
import { ATXPMcpApi } from '../mcpApi.js';
import { BigNumber } from 'bignumber.js';
import './setup.js';

// Mock external dependencies
vi.mock('@atxp/server', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    requirePayment: vi.fn(),
    withATXPContext: vi.fn()
  };
});

vi.mock('../workerContext.js', () => ({
  getATXPConfig: vi.fn()
}));

import { getATXPConfig } from '../workerContext.js';
import { requirePayment as mockRequirePaymentSDK, withATXPContext as mockWithATXPContext } from '@atxp/server';

describe('requirePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ATXPMcpApi.reset();
    (mockWithATXPContext as any).mockImplementation(async (config, resource, tokenInfo, callback) => {
      await callback();
    });
  });

  it('should require payment with existing config', async () => {
    const mockConfig = { logger: { error: vi.fn() } };
    (getATXPConfig as any).mockReturnValue(mockConfig);

    const paymentConfig = {
      price: new BigNumber(0.01),
      authenticatedUser: 'test-user',
      userToken: 'test-token',
      atxpInitParams: {
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base' as const,
        resourceUrl: 'https://example.com/'
      }
    };

    await requirePayment(paymentConfig);

    expect(mockWithATXPContext).toHaveBeenCalledWith(
      mockConfig,
      new URL('https://example.com/'),
      {
        token: 'test-token',
        data: { active: true, sub: 'test-user' }
      },
      expect.any(Function)
    );

    expect(mockRequirePaymentSDK).toHaveBeenCalledWith(paymentConfig);
  });

  it('should initialize ATXP if no config exists but init params are provided', async () => {
    (getATXPConfig as any).mockReturnValue(null);

    const initSpy = vi.spyOn(ATXPMcpApi, 'init');
    const getConfigSpy = vi.spyOn(ATXPMcpApi, 'getConfig').mockReturnValue({ logger: { error: vi.fn() } });

    const paymentConfig = {
      price: new BigNumber(0.01),
      authenticatedUser: 'test-user',
      userToken: 'test-token',
      atxpInitParams: {
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base' as const,
        resourceUrl: 'https://example.com/'
      }
    };

    await requirePayment(paymentConfig);

    expect(initSpy).toHaveBeenCalledWith(paymentConfig.atxpInitParams);
    expect(getConfigSpy).toHaveBeenCalled();
  });

  it('should throw error if no config and no init params', async () => {
    (getATXPConfig as any).mockReturnValue(null);

    const paymentConfig = {
      price: new BigNumber(0.01),
      authenticatedUser: 'test-user',
      userToken: 'test-token'
    };

    await expect(requirePayment(paymentConfig)).rejects.toThrow('No ATXP config found - payments cannot be processed');
  });

  it('should throw error if no authenticated user', async () => {
    const mockConfig = { logger: { error: vi.fn() } };
    (getATXPConfig as any).mockReturnValue(mockConfig);

    const paymentConfig = {
      price: new BigNumber(0.01),
      userToken: 'test-token',
      atxpInitParams: {
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base' as const,
        resourceUrl: 'https://example.com/'
      }
    };

    await expect(requirePayment(paymentConfig)).rejects.toThrow('No authenticated user and/or user token found - payment required');
  });

  it('should throw error if no user token', async () => {
    const mockConfig = { logger: { error: vi.fn() } };
    (getATXPConfig as any).mockReturnValue(mockConfig);

    const paymentConfig = {
      price: new BigNumber(0.01),
      authenticatedUser: 'test-user',
      atxpInitParams: {
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base' as const,
        resourceUrl: 'https://example.com/'
      }
    };

    await expect(requirePayment(paymentConfig)).rejects.toThrow('No authenticated user and/or user token found - payment required');
  });

  it('should throw error if no resource URL in init params', async () => {
    const mockConfig = { logger: { error: vi.fn() } };
    (getATXPConfig as any).mockReturnValue(mockConfig);

    const paymentConfig = {
      price: new BigNumber(0.01),
      authenticatedUser: 'test-user',
      userToken: 'test-token',
      atxpInitParams: {
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base' as const
      }
    };

    await expect(requirePayment(paymentConfig)).rejects.toThrow('Resource URL not provided in ATXP init params');
  });

  it('should handle ATXP initialization failure gracefully', async () => {
    (getATXPConfig as any).mockReturnValue(null);

    const initSpy = vi.spyOn(ATXPMcpApi, 'init').mockImplementation(() => {
      throw new Error('Init failed');
    });

    const paymentConfig = {
      price: new BigNumber(0.01),
      authenticatedUser: 'test-user',
      userToken: 'test-token',
      atxpInitParams: {
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base' as const,
        resourceUrl: 'https://example.com/'
      }
    };

    await expect(requirePayment(paymentConfig)).rejects.toThrow('No ATXP config found - payments cannot be processed');

    expect(initSpy).toHaveBeenCalled();
    // Note: getConfig is not called when init fails, which is the expected behavior
  });
});