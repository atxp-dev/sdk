import { describe, it, expect, vi } from 'vitest';
import { ATXPAccount } from './atxpAccount.js';
import BigNumber from 'bignumber.js';

describe('ATXPAccount', () => {
  describe('ATXPHttpPaymentMaker.getSourceAddress', () => {
    it('should call /address_for_payment endpoint and return sourceAddress', async () => {
      const mockFetch = vi.fn();
      const sourceAddress = '0x1234567890123456789012345678901234567890';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sourceAddress,
          sourceNetwork: 'base'
        })
      });

      const connectionString = 'https://accounts.atxp.ai?connection_token=test_token&account_id=acc_123';
      const account = new ATXPAccount(connectionString, { fetchFn: mockFetch, network: 'base' });

      const paymentMaker = account.paymentMakers[0];
      const result = await paymentMaker.getSourceAddress({
        amount: new BigNumber('10'),
        currency: 'USDC',
        receiver: '0xabcdef0123456789abcdef0123456789abcdef01',
        memo: 'test payment'
      });

      expect(result).toBe(sourceAddress);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.atxp.ai/address_for_payment',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic'),
            'Content-Type': 'application/json',
          }),
          body: expect.any(String)
        })
      );

      // Verify the body contains the expected parameters
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toEqual({
        amount: '10',
        currency: 'USDC',
        receiver: '0xabcdef0123456789abcdef0123456789abcdef01',
        memo: 'test payment'
      });
    });

    it('should throw error if /address_for_payment fails', async () => {
      const mockFetch = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      });

      const connectionString = 'https://accounts.atxp.ai?connection_token=test_token&account_id=acc_123';
      const account = new ATXPAccount(connectionString, { fetchFn: mockFetch, network: 'base' });

      const paymentMaker = account.paymentMakers[0];

      await expect(paymentMaker.getSourceAddress({
        amount: new BigNumber('10'),
        currency: 'USDC',
        receiver: '0xabcdef0123456789abcdef0123456789abcdef01',
        memo: 'test payment'
      })).rejects.toThrow(
        /address_for_payment failed/
      );
    });

    it('should throw error if sourceAddress is missing from response', async () => {
      const mockFetch = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sourceNetwork: 'base'
          // sourceAddress is missing
        })
      });

      const connectionString = 'https://accounts.atxp.ai?connection_token=test_token&account_id=acc_123';
      const account = new ATXPAccount(connectionString, { fetchFn: mockFetch, network: 'base' });

      const paymentMaker = account.paymentMakers[0];

      await expect(paymentMaker.getSourceAddress({
        amount: new BigNumber('10'),
        currency: 'USDC',
        receiver: '0xabcdef0123456789abcdef0123456789abcdef01',
        memo: 'test payment'
      })).rejects.toThrow(
        /did not return sourceAddress/
      );
    });

    it('should use correct authorization header', async () => {
      const mockFetch = vi.fn();
      const token = 'test_secret_token';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sourceAddress: '0x1234567890123456789012345678901234567890',
          sourceNetwork: 'base'
        })
      });

      const connectionString = `https://accounts.atxp.ai?connection_token=${token}&account_id=acc_123`;
      const account = new ATXPAccount(connectionString, { fetchFn: mockFetch, network: 'base' });

      const paymentMaker = account.paymentMakers[0];
      await paymentMaker.getSourceAddress({
        amount: new BigNumber('10'),
        currency: 'USDC',
        receiver: '0xabcdef0123456789abcdef0123456789abcdef01',
        memo: 'test payment'
      });

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      expect(authHeader).toMatch(/^Basic /);

      // Decode and verify the Basic auth format (token:)
      const base64Part = authHeader.replace('Basic ', '');
      const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');
      expect(decoded).toBe(`${token}:`);
    });

    it('should return consistent address across multiple calls', async () => {
      const mockFetch = vi.fn();
      const sourceAddress = '0x1234567890123456789012345678901234567890';

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          sourceAddress,
          sourceNetwork: 'base'
        })
      });

      const connectionString = 'https://accounts.atxp.ai?connection_token=test_token&account_id=acc_123';
      const account = new ATXPAccount(connectionString, { fetchFn: mockFetch, network: 'base' });

      const paymentMaker = account.paymentMakers[0];
      const params = {
        amount: new BigNumber('10'),
        currency: 'USDC' as const,
        receiver: '0xabcdef0123456789abcdef0123456789abcdef01',
        memo: 'test payment'
      };
      const address1 = await paymentMaker.getSourceAddress(params);
      const address2 = await paymentMaker.getSourceAddress(params);

      expect(address1).toBe(address2);
      expect(address1).toBe(sourceAddress);
    });
  });
});
