import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPPaymentDestination, ChainPaymentDestination } from './paymentDestination.js';
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
        chainType: 'base'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    const result = await atxpDestination.destination(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.example.com/destination?connectionToken=abc123&buyerAddress=0xbuyer&amount=100',
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
        chainType: 'base'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await expect(atxpDestination.destination(
      { amount: new BigNumber('100'), currency: 'USDC' },
      '0xbuyer'
    )).rejects.toThrow('ATXPPaymentDestination: /destination did not return destination');
  });

  it('should throw an error if response is missing chainType', async () => {
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
    )).rejects.toThrow('ATXPPaymentDestination: /destination did not return chainType');
  });

  it('should handle decimal amounts correctly', async () => {
    const connectionString = 'https://accounts.example.com/?connection_token=abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        destination: '0x1234567890123456789012345678901234567890',
        chainType: 'base'
      })
    });

    const atxpDestination = new ATXPPaymentDestination(connectionString, { fetchFn: mockFetch });

    await atxpDestination.destination(
      { amount: new BigNumber('0.01'), currency: 'USDC' },
      '0xbuyer'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.example.com/destination?connectionToken=abc123&buyerAddress=0xbuyer&amount=0.01',
      expect.any(Object)
    );
  });
});