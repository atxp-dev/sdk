import { describe, it, expect, vi } from 'vitest';
import { getBalance } from './getBalance.js';
import * as TH from './serverTestHelpers.js';
import { BigNumber } from 'bignumber.js';
import { withATXPContext } from './atxpContext.js';

describe('getBalance', () => {
  it('should return balance from the payment server', async () => {
    const ps = TH.paymentServer({ getBalance: vi.fn().mockResolvedValue(new BigNumber('42.50')) });
    const config = TH.config({ paymentServer: ps });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      const balance = await getBalance();
      expect(balance.toString()).toBe('42.5');
      expect(ps.getBalance).toHaveBeenCalledWith({
        sourceAccountId: 'test-user',
        destinationAccountId: `base:${TH.DESTINATION}`,
        sourceAccountToken: 'test-token',
      });
    });
  });

  it('should throw if no config is available', async () => {
    // No withATXPContext wrapper, so config is null
    await expect(getBalance()).rejects.toThrow('No config found');
  });

  it('should throw if no user is found', async () => {
    const config = TH.config();
    // tokenCheck with null data means no user
    await withATXPContext(config, new URL('https://example.com'), { token: null, data: null }, async () => {
      await expect(getBalance()).rejects.toThrow('No user found');
    });
  });

  it('should omit sourceAccountToken when no token in context', async () => {
    const ps = TH.paymentServer({ getBalance: vi.fn().mockResolvedValue(new BigNumber('10.00')) });
    const config = TH.config({ paymentServer: ps });
    // Pass tokenCheck with a token but no sourceAccountToken (token value is used for atxpToken)
    // Actually, to simulate no token, we pass token: null but data with sub (user exists but no token)
    const tokenInfo = { token: null, data: { sub: 'test-user' } as any };
    await withATXPContext(config, new URL('https://example.com'), tokenInfo, async () => {
      const balance = await getBalance();
      expect(balance.toString()).toBe('10');
      expect(ps.getBalance).toHaveBeenCalledWith({
        sourceAccountId: 'test-user',
        destinationAccountId: `base:${TH.DESTINATION}`,
        // No sourceAccountToken since token is null
      });
    });
  });

  it('should propagate errors from payment server', async () => {
    const ps = TH.paymentServer({ getBalance: vi.fn().mockRejectedValue(new Error('Balance lookup failed')) });
    const config = TH.config({ paymentServer: ps });
    await withATXPContext(config, new URL('https://example.com'), TH.tokenCheck(), async () => {
      await expect(getBalance()).rejects.toThrow('Balance lookup failed');
    });
  });
});
