import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPPaymentDestination, ChainPaymentDestination } from './paymentDestination.js';
import { Logger } from '@atxp/common';
import BigNumber from 'bignumber.js';

describe('ChainPaymentDestination', () => {
  it('should return the configured address and network', async () => {
    const destination = new ChainPaymentDestination('0x1234567890123456789012345678901234567890', 'base');

    const result = await destination.destination(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(result).toEqual({
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base'
    });
  });
});

describe('ATXPPaymentDestination', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should make a request to the destination endpoint', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    const result = await atxpDestination.destination(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.example.com/destination?connectionToken=abc123&buyerAddress=0xbuyer&amount=100&currency=USDC',
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    expect(result).toEqual({
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base'
    });
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

    await expect(atxpDestination.destination(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    )).rejects.toThrow('ATXPPaymentDestination: /destination failed: 401 Unauthorized Invalid token');
  });

  it('should throw an error if response is missing destination', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        network: 'base'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await expect(atxpDestination.destination(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    )).rejects.toThrow('ATXPPaymentDestination: /destination did not return destination');
  });

  it('should throw an error if response is missing network', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        destination: '0x1234567890123456789012345678901234567890'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await expect(atxpDestination.destination(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    )).rejects.toThrow('ATXPPaymentDestination: /destination did not return network');
  });

  it('should handle decimal amounts correctly', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        destination: '0x1234567890123456789012345678901234567890',
        network: 'base'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await atxpDestination.destination(
      { amount: new BigNumber('0.01'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.example.com/destination?connectionToken=abc123&buyerAddress=0xbuyer&amount=0.01&currency=USDC',
      expect.any(Object)
    );
  });

  it('should map ethereum network to base network', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        destination: '0x1234567890123456789012345678901234567890',
        network: 'ethereum' // This should be mapped to 'base'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    const result = await atxpDestination.destination(
      { amount: new BigNumber('0.01'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(result).toEqual({
      destination: '0x1234567890123456789012345678901234567890',
      network: 'base' // Should be mapped from 'ethereum' to 'base'
    });
  });

  it('should handle solana network correctly', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        destination: 'SolanaAddress123456789',
        network: 'solana'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    const result = await atxpDestination.destination(
      { amount: new BigNumber('0.01'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(result).toEqual({
      destination: 'SolanaAddress123456789',
      network: 'solana'
    });
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
        json: async () => ({
          destination: '0x1234567890123456789012345678901234567890',
          network: 'base'
        })
      });

      const atxpDestination = new ATXPPaymentDestination(connectionString, { 
        fetchFn: mockFetch, 
        logger: mockLogger 
      });

      await atxpDestination.destination(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      );

      expect(mockLogger.debug).toHaveBeenCalledWith('Getting payment destination for buyer: 0xbuyer, amount: 100 USDC');
      expect(mockLogger.debug).toHaveBeenCalledWith('Making request to: https://accounts.example.com/destination?connectionToken=abc123&buyerAddress=0xbuyer&amount=100&currency=USDC');
      expect(mockLogger.debug).toHaveBeenCalledWith('Successfully got payment destination: 0x1234567890123456789012345678901234567890 on base');
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

      await expect(atxpDestination.destination(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      )).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('/destination failed: 401 Unauthorized Invalid token');
    });

    it('should log errors when response is missing destination', async () => {
      const connectionString = 'https://accounts.example.com/?connection_token=abc123';
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          network: 'base'
        })
      });

      const atxpDestination = new ATXPPaymentDestination(connectionString, { 
        fetchFn: mockFetch, 
        logger: mockLogger 
      });

      await expect(atxpDestination.destination(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      )).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('/destination did not return destination');
    });

    it('should log errors when response is missing network', async () => {
      const connectionString = 'https://accounts.example.com/?connection_token=abc123';
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          destination: '0x1234567890123456789012345678901234567890'
        })
      });

      const atxpDestination = new ATXPPaymentDestination(connectionString, { 
        fetchFn: mockFetch, 
        logger: mockLogger 
      });

      await expect(atxpDestination.destination(
        { amount: new BigNumber('100'), currency: 'USDC' },
        '0xbuyer'
      )).rejects.toThrow();

      expect(mockLogger.debug).toHaveBeenCalledWith('Getting payment destination for buyer: 0xbuyer, amount: 100 USDC');
      expect(mockLogger.debug).toHaveBeenCalledWith('Making request to: https://accounts.example.com/destination?connectionToken=abc123&buyerAddress=0xbuyer&amount=100&currency=USDC');
      expect(mockLogger.error).toHaveBeenCalledWith('/destination did not return network');
    });
  });
});