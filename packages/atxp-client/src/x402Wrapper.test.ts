import { describe, it, expect, vi } from 'vitest';
import { wrapWithX402 } from './x402Wrapper.js';
import type { Account, EIP3009Authorization, X402Message } from './types.js';
import { BigNumber } from 'bignumber.js';

describe('X402 Wrapper', () => {
  it('should produce valid X402 message structure matching protocol specification', async () => {
    // Mock account with test payment maker
    const mockAccount: Account = {
      accountId: 'test-account',
      paymentMakers: {
        'base:USDC': {
          async createPaymentAuthorization(
            amount: BigNumber,
            _currency: string,
            receiver: string,
            _memo: string
          ): Promise<EIP3009Authorization> {
            // Mock EIP-3009 authorization response
            return {
              signature: '0xabcdef123456789',
              authorization: {
                from: '0x1234567890123456789012345678901234567890',
                to: receiver,
                value: amount.multipliedBy(1e6).toFixed(0), // USDC has 6 decimals
                validAfter: Math.floor(Date.now() / 1000).toString(),
                validBefore: (Math.floor(Date.now() / 1000) + 3600).toString(),
                nonce: '0x' + '0'.repeat(64)
              }
            };
          }
        }
      }
    };

    // Mock fetch that returns 402 with payment requirements
    const mockFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (!init?.headers || !(init.headers as any)['X-Payment']) {
        // First request - return 402 challenge
        return {
          status: 402,
          ok: false,
          json: async () => ({}),
          text: async () => '',
          headers: {
            get: (name: string) => {
              if (name === 'X-Payment-Required') {
                return JSON.stringify({
                  network: 'base',
                  currency: 'USDC',
                  amount: '0.01',
                  recipient: '0xrecipient123',
                  memo: 'test payment'
                });
              }
              return null;
            }
          }
        };
      }

      // Second request with payment - verify X402 message structure
      const x402Message = JSON.parse((init.headers as any)['X-Payment']) as X402Message;

      // Verify top-level X402 protocol fields
      expect(x402Message).toHaveProperty('x402Version');
      expect(x402Message).toHaveProperty('scheme');
      expect(x402Message).toHaveProperty('network');
      expect(x402Message).toHaveProperty('payload');

      expect(x402Message.x402Version).toBe(1);
      expect(x402Message.scheme).toBe('exact');
      expect(x402Message.network).toBe('base');

      // Verify EIP-3009 payload structure
      expect(x402Message.payload).toHaveProperty('signature');
      expect(x402Message.payload).toHaveProperty('authorization');

      const auth = x402Message.payload.authorization;
      expect(auth).toHaveProperty('from');
      expect(auth).toHaveProperty('to');
      expect(auth).toHaveProperty('value');
      expect(auth).toHaveProperty('validAfter');
      expect(auth).toHaveProperty('validBefore');
      expect(auth).toHaveProperty('nonce');

      // Verify value is correctly converted to USDC units (6 decimals)
      expect(auth.value).toBe('10000'); // 0.01 USDC = 10000 units
      expect(auth.to).toBe('0xrecipient123');

      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
        headers: {
          get: () => null
        }
      };
    });

    const wrappedFetch = wrapWithX402(mockFetch as any, mockAccount);
    const response = await wrappedFetch('https://example.com/api/resource');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should handle non-402 responses without modification', async () => {
    const mockAccount: Account = {
      accountId: 'test-account',
      paymentMakers: {}
    };
    const mockFetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({}),
      text: async () => '',
      headers: {
        get: () => null
      }
    }));

    const wrappedFetch = wrapWithX402(mockFetch as any, mockAccount);
    const response = await wrappedFetch('https://example.com/api/resource');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle 402 responses without X-Payment-Required header', async () => {
    const mockAccount: Account = {
      accountId: 'test-account',
      paymentMakers: {}
    };
    const mockFetch = vi.fn(async () => ({
      status: 402,
      ok: false,
      json: async () => ({}),
      text: async () => '',
      headers: {
        get: () => null
      }
    }));

    const wrappedFetch = wrapWithX402(mockFetch as any, mockAccount);
    const response = await wrappedFetch('https://example.com/api/resource');

    expect(response.status).toBe(402);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});