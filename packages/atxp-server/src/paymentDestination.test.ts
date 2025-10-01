import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPPaymentDestination, ChainPaymentDestination } from './paymentDestination.js';
import { Logger } from '@atxp/common';
import BigNumber from 'bignumber.js';

describe('ChainPaymentDestination', () => {
  it('should return the configured address and network', async () => {
    const destination = new ChainPaymentDestination('0x1234567890123456789012345678901234567890', 'base');

    const result = await destination.destinations(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(result).toEqual([{
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base'
    }]);
  });
});

describe('ATXPPaymentDestination', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should make a request to the addresses endpoint and return all addresses', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          address: '0x1234567890123456789012345678901234567890',
          network: 'base'
        }
      ])
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    const result = await atxpDestination.destinations(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.example.com/addresses?currency=USDC',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Basic YWJjMTIzOg==',
          'Accept': 'application/json',
        },
      }
    );

    expect(result).toEqual([{
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base'
    }]);
  });

  it('should throw an error if connection string is missing token', () => {
    const connectionString = 'https://accounts.example.com/';

    expect(() => {
      new ATXPPaymentDestination(connectionString);
    }).toThrow('ATXPPaymentDestination: connection string missing connection token');
  });

  it('should throw an error if the API request fails', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid token'
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await expect(atxpDestination.destinations(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    )).rejects.toThrow('ATXPPaymentDestination: /addresses failed: 401 Unauthorized Invalid token');
  });

  it('should throw an error if response has no addresses', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([])
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await expect(atxpDestination.destinations(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    )).rejects.toThrow('ATXPPaymentDestination: /addresses did not return any addresses');
  });

  it('should throw an error if response has invalid addresses', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          address: '0x1234567890123456789012345678901234567890'
          // missing network
        }
      ])
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await expect(atxpDestination.destinations(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    )).rejects.toThrow('ATXPPaymentDestination: no valid addresses returned');
  });

  it('should handle different currencies correctly', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          address: '0x1234567890123456789012345678901234567890',
          network: 'base'
        }
      ])
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await atxpDestination.destinations(
      { amount: new BigNumber('0.01'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.example.com/addresses?currency=USDC',
      expect.any(Object)
    );
  });

  it('should map ethereum network to base network', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          address: '0x1234567890123456789012345678901234567890',
          network: 'ethereum' // This should be mapped to 'base'
        }
      ])
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    const result = await atxpDestination.destinations(
      { amount: new BigNumber('0.01'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(result).toEqual([{
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base' // Should be mapped from 'ethereum' to 'base'
    }]);
  });

  it('should handle solana network correctly', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          address: 'SolanaAddress123456789',
          network: 'solana'
        }
      ])
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    const result = await atxpDestination.destinations(
      { amount: new BigNumber('0.01'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(result).toEqual([{
      destination: 'SolanaAddress123456789',
      network: 'solana'
    }]);
  });

  describe('logger functionality', () => {
    it('should use default ConsoleLogger when no logger is provided', () => {
      const connectionString = 'https://accounts.example.com/?connection_token=abc123';
      const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });
      
      // The logger should be a ConsoleLogger instance (we can't easily test the exact type without exposing it)
      expect(atxpDestination).toBeDefined();
    });

    it('should use custom logger when provided', async () => {
      const connectionString = 'https://accounts.example.com/?connection_token=abc123';
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ([
          {
            address: '0x1234567890123456789012345678901234567890',
            network: 'base'
          }
        ])
      });

      const atxpDestination = new ATXPPaymentDestination(connectionString, {
        fetchFn: mockFetch,
        logger: mockLogger
      });

      await atxpDestination.destinations(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      );

      expect(mockLogger.debug).toHaveBeenCalledWith('Getting payment destinations for buyer: 0xbuyer, amount: 100 USDC');
      expect(mockLogger.debug).toHaveBeenCalledWith('Making request to: https://accounts.example.com/addresses?currency=USDC');
      expect(mockLogger.debug).toHaveBeenCalledWith('Successfully got 1 payment destinations');
    });

    it('should log errors when API request fails', async () => {
      const connectionString = 'https://accounts.example.com/?connection_token=abc123';
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token'
      });

      const atxpDestination = new ATXPPaymentDestination(connectionString, {
        fetchFn: mockFetch,
        logger: mockLogger
      });

      await expect(atxpDestination.destinations(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      )).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('/addresses failed: 401 Unauthorized Invalid token');
    });

    it('should log errors when response has no addresses', async () => {
      const connectionString = 'https://accounts.example.com/?connection_token=abc123';
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ([])
      });

      const atxpDestination = new ATXPPaymentDestination(connectionString, {
        fetchFn: mockFetch,
        logger: mockLogger
      });

      await expect(atxpDestination.destinations(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      )).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('/addresses did not return any addresses');
    });

    it('should log warnings when response has invalid addresses', async () => {
      const connectionString = 'https://accounts.example.com/?connection_token=abc123';
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ([
          {
            address: '0x1234567890123456789012345678901234567890'
            // missing network
          }
        ])
      });

      const atxpDestination = new ATXPPaymentDestination(connectionString, {
        fetchFn: mockFetch,
        logger: mockLogger
      });

      await expect(atxpDestination.destinations(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      )).rejects.toThrow();

      expect(mockLogger.debug).toHaveBeenCalledWith('Getting payment destinations for buyer: 0xbuyer, amount: 100 USDC');
      expect(mockLogger.debug).toHaveBeenCalledWith('Making request to: https://accounts.example.com/addresses?currency=USDC');
      expect(mockLogger.warn).toHaveBeenCalledWith('Skipping invalid address entry');
    });
  });
});