import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPAccount } from './atxpAccount.js';
import { BigNumber } from 'bignumber.js';

describe('ATXPAccount', () => {
  describe('constructor', () => {
    it('should parse connection string with token and account_id', () => {
      const connectionString = 'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz';
      const account = new ATXPAccount(connectionString);
      expect(account.origin).toBe('https://accounts.example.com');
      expect(account.token).toBe('ct_abc123');
    });

    it('should throw if connection string is empty', () => {
      expect(() => new ATXPAccount('')).toThrow('connection string is empty');
    });

    it('should throw if connection token is missing', () => {
      expect(() => new ATXPAccount('https://accounts.example.com')).toThrow('missing connection token');
    });
  });

  describe('createSpendPermission', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
    });

    it('should call /spend-permission with Bearer auth and return token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ spendPermissionToken: 'spt_test123' }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      const token = await account.createSpendPermission('https://my-mcp-server.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.example.com/spend-permission',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ct_abc123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ resourceUrl: 'https://my-mcp-server.com' }),
        }
      );
      expect(token).toBe('spt_test123');
    });

    it('should throw if response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid resourceUrl',
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      await expect(account.createSpendPermission('invalid-url')).rejects.toThrow(
        '/spend-permission failed: 400 Bad Request'
      );
    });

    it('should throw if response does not contain spendPermissionToken', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ someOtherField: 'value' }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      await expect(account.createSpendPermission('https://mcp.example.com')).rejects.toThrow(
        'did not return spendPermissionToken'
      );
    });
  });

  describe('getAccountId', () => {
    it('should return cached account ID from connection string', async () => {
      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz'
      );
      const accountId = await account.getAccountId();
      expect(accountId).toBe('atxp:atxp_acct_xyz');
    });

    it('should fetch account ID from /me if not in connection string', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accountId: 'atxp_acct_fetched' }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123',
        { fetchFn: mockFetch }
      );

      const accountId = await account.getAccountId();
      expect(accountId).toBe('atxp:atxp_acct_fetched');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.example.com/me',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ct_abc123',
            'Accept': 'application/json',
          },
        })
      );
    });
  });

  describe('getProfile', () => {
    it('should return cached profile after getAccountId fetches /me', async () => {
      const meResponse = {
        accountId: 'atxp_acct_test',
        accountType: 'agent',
        funded: false,
        developerMode: false,
        stripeConnected: false,
      };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => meResponse,
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123',
        { fetchFn: mockFetch }
      );

      // First call triggers /me fetch
      const profile = await account.getProfile();
      expect(profile).toEqual(meResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call returns cached — no extra fetch
      const profile2 = await account.getProfile();
      expect(profile2).toEqual(meResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should share /me response with getAccountId (no duplicate request)', async () => {
      const meResponse = {
        accountId: 'atxp_acct_shared',
        accountType: 'human',
        funded: undefined,
      };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => meResponse,
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123',
        { fetchFn: mockFetch }
      );

      // getAccountId fetches /me
      const accountId = await account.getAccountId();
      expect(accountId).toBe('atxp:atxp_acct_shared');

      // getProfile returns cached data — no extra request
      const profile = await account.getProfile();
      expect(profile.accountType).toBe('human');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should fetch /me even when account_id is in connection string', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'atxp_acct_inline',
          accountType: 'agent',
          funded: false,
        }),
      });

      // account_id is in the connection string, so getAccountId() won't call /me
      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_inline',
        { fetchFn: mockFetch }
      );

      // getAccountId uses cached value — no fetch
      const accountId = await account.getAccountId();
      expect(accountId).toBe('atxp:atxp_acct_inline');
      expect(mockFetch).not.toHaveBeenCalled();

      // getProfile must fetch /me to get full profile
      const profile = await account.getProfile();
      expect(profile.accountType).toBe('agent');
      expect(profile.funded).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return profile with funded field for agent accounts', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accountId: 'atxp_acct_agent',
          accountType: 'agent',
          funded: true,
        }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123',
        { fetchFn: mockFetch }
      );

      const profile = await account.getProfile();
      expect(profile.accountType).toBe('agent');
      expect(profile.funded).toBe(true);
    });
  });

  describe('authorize', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
    });

    it('should call /authorize/atxp with correct body and inject sourceAccountToken', async () => {
      const responseBody = { authorized: true, sourceAccountId: 'acct_123', options: {} };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ...responseBody }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      const result = await account.authorize({
        protocol: 'atxp',
        amount: new BigNumber('2.5'),
        destination: '0xrecipient',
        memo: 'test memo',
      });

      expect(result.protocol).toBe('atxp');
      const parsed = JSON.parse(result.credential);
      expect(parsed.authorized).toBe(true);
      expect(parsed.sourceAccountToken).toBe('ct_abc123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://accounts.example.com/authorize/atxp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            amount: '2.5',
            currency: 'USDC',
            receiver: '0xrecipient',
            memo: 'test memo',
          }),
        })
      );

      // Verify Basic auth header
      const callHeaders = mockFetch.mock.calls[0][1].headers;
      const expectedAuth = `Basic ${Buffer.from('ct_abc123:').toString('base64')}`;
      expect(callHeaders['Authorization']).toBe(expectedAuth);
    });

    it('should call /authorize/x402 and return paymentHeader as credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ paymentHeader: 'x402-header-value' }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      const result = await account.authorize({
        protocol: 'x402',
        amount: new BigNumber('1'),
        destination: 'https://example.com',
        paymentRequirements: { network: 'base' },
      });

      expect(result.protocol).toBe('x402');
      expect(result.credential).toBe('x402-header-value');
    });

    it('should call /authorize/mpp and return credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ credential: 'mpp-cred-value' }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      const result = await account.authorize({
        protocol: 'mpp',
        amount: new BigNumber('1'),
        destination: 'https://example.com',
        challenge: { id: 'ch_1' },
      });

      expect(result.protocol).toBe('mpp');
      expect(result.credential).toBe('mpp-cred-value');
    });

    it('should throw when server returns non-OK status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      await expect(
        account.authorize({
          protocol: 'atxp',
          amount: new BigNumber('1'),
          destination: '0xrecipient',
        })
      ).rejects.toThrow('/authorize/atxp failed (500)');
    });

    it('should throw when x402 response missing paymentHeader', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ invalid: 'response' }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      await expect(
        account.authorize({
          protocol: 'x402',
          amount: new BigNumber('1'),
          destination: 'https://example.com',
          paymentRequirements: {},
        })
      ).rejects.toThrow('missing or invalid paymentHeader');
    });

    it('should throw when mpp response missing credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ somethingElse: 'value' }),
      });

      const account = new ATXPAccount(
        'https://accounts.example.com?connection_token=ct_abc123&account_id=atxp_acct_xyz',
        { fetchFn: mockFetch }
      );

      await expect(
        account.authorize({
          protocol: 'mpp',
          amount: new BigNumber('1'),
          destination: 'https://example.com',
          challenge: {},
        })
      ).rejects.toThrow('missing or invalid credential');
    });
  });
});
