import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPAccount } from './atxpAccount.js';

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
});
