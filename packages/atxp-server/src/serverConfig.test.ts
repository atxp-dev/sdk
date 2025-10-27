import { describe, it, expect } from 'vitest';
import { buildServerConfig } from './serverConfig.js';
import { BigNumber } from 'bignumber.js';
import type { Account } from '@atxp/common';

// Helper to create a mock Account for testing
function mockAccount(accountId: string): Account {
  return {
    accountId: `base:${accountId}` as any,
    paymentMakers: [],
    getSources: async () => [],
  };
}

describe('buildServerConfig', () => {
  describe('minimumPayment validation', () => {
    it('should throw an error if minimumPayment exceeds $1.00', () => {
      const destination = mockAccount('testDestination');

      expect(() => {
        buildServerConfig({
          destination,
          minimumPayment: BigNumber(1.01) // $1.01, should throw
        });
      }).toThrow('minimumPayment cannot exceed $1.00');

      expect(() => {
        buildServerConfig({
          destination,
          minimumPayment: BigNumber(5) // $5.00, should throw
        });
      }).toThrow('minimumPayment cannot exceed $1.00');
    });

    it('should allow minimumPayment of exactly $1.00', () => {
      const destination = mockAccount('testDestination');

      expect(() => {
        buildServerConfig({
          destination,
          minimumPayment: BigNumber(1) // $1.00, should be allowed
        });
      }).not.toThrow();
    });

    it('should allow minimumPayment less than $1.00', () => {
      const destination = mockAccount('testDestination');

      expect(() => {
        buildServerConfig({
          destination,
          minimumPayment: BigNumber(0.05) // $0.05, should be allowed
        });
      }).not.toThrow();

      expect(() => {
        buildServerConfig({
          destination,
          minimumPayment: BigNumber(0.99) // $0.99, should be allowed
        });
      }).not.toThrow();
    });

    it('should allow no minimumPayment', () => {
      const destination = mockAccount('testDestination');

      expect(() => {
        buildServerConfig({
          destination
          // No minimumPayment provided
        });
      }).not.toThrow();
    });
  });
});