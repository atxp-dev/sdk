import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requirePayment } from '../requirePayment.js';
import { BigNumber } from 'bignumber.js';
import './setup.js';
import type { ATXPConfig, TokenCheck } from '@atxp/server';
import { Account } from '@atxp/client';

// Mock external dependencies
vi.mock('@atxp/server', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    requirePayment: vi.fn(),
    withATXPContext: vi.fn(),
    buildServerConfig: vi.fn()
  };
});

import {
  requirePayment as mockRequirePaymentSDK,
  withATXPContext as mockWithATXPContext,
  buildServerConfig as mockBuildServerConfig
} from '@atxp/server';

// Helper to create a mock Account for testing
function mockAccount(accountId: string): Account {
  return {
    accountId,
    paymentMakers: {}
  };
}

describe('requirePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockWithATXPContext as any).mockImplementation(async (config: ATXPConfig, resource: URL, tokenInfo: TokenCheck | null, callback: () => Promise<void>) => {
      await callback();
    });
    (mockBuildServerConfig as any).mockImplementation((args: any) => ({
      logger: { error: vi.fn() },
      ...args
    }));
  });

  it('should require payment with config args', async () => {
    const configOpts = {
      payeeName: 'Test Payee',
      destination: mockAccount('0x1234')
    };

    const mcpProps = {
      resource: new URL('https://example.com'),
      tokenCheck: {
        passes: true as const,
        token: 'test-token',
        data: { active: true, sub: 'test-user' }
      }
    };

    const paymentConfig = {
      price: new BigNumber(0.01)
    };

    await requirePayment(paymentConfig, configOpts, mcpProps);

    expect(mockBuildServerConfig).toHaveBeenCalledWith(configOpts);
    expect(mockWithATXPContext).toHaveBeenCalledWith(
      expect.objectContaining({ logger: expect.any(Object) }),
      mcpProps.resource,
      mcpProps.tokenCheck,
      expect.any(Function)
    );
    expect(mockRequirePaymentSDK).toHaveBeenCalledWith(paymentConfig);
  });

  it('should handle null token check', async () => {
    const configOpts = {
      payeeName: 'Test Payee',
      destination: mockAccount('0x1234')
    };

    const mcpProps = {
      resource: new URL('https://example.com'),
      tokenCheck: null
    };

    const paymentConfig = {
      price: new BigNumber(0.01)
    };

    await requirePayment(paymentConfig, configOpts, mcpProps);

    expect(mockBuildServerConfig).toHaveBeenCalledWith(configOpts);
    expect(mockWithATXPContext).toHaveBeenCalledWith(
      expect.objectContaining({ logger: expect.any(Object) }),
      mcpProps.resource,
      null,
      expect.any(Function)
    );
    expect(mockRequirePaymentSDK).toHaveBeenCalledWith(paymentConfig);
  });

});