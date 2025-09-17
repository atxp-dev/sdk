import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requirePayment } from '../requirePayment.js';
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
  getATXPWorkerContext: vi.fn()
}));

import { requirePayment as mockRequirePaymentSDK, withATXPContext as mockWithATXPContext } from '@atxp/server';
import { getATXPWorkerContext } from '../workerContext.js';

describe('requirePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockWithATXPContext as any).mockImplementation(async (config, resource, tokenInfo, callback) => {
      await callback();
    });
  });

  it('should require payment with existing config', async () => {
    const mockConfig = { logger: { error: vi.fn() } };
    const mockTokenCheck = {
      token: 'test-token',
      data: { active: true, sub: 'test-user' }
    };
    (getATXPWorkerContext as any).mockReturnValue({ config: mockConfig, resource: new URL('https://example.com'), tokenCheck: mockTokenCheck });

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
      mockTokenCheck,
      expect.any(Function)
    );

    expect(mockRequirePaymentSDK).toHaveBeenCalledWith(paymentConfig);
  });

});