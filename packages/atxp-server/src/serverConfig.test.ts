import { describe, it, expect } from 'vitest';
import { buildServerConfig } from './serverConfig.js';
import { BigNumber } from 'bignumber.js';
import { ChainPaymentDestination } from './paymentDestination.js';

describe('buildServerConfig', () => {
  const TEST_DEVELOPER_TOKEN = 'atxp_dev_test123456789';

  describe('required fields validation', () => {
    it('should throw an error if paymentDestination is missing', () => {
      expect(() => {
        buildServerConfig({
          atxpDeveloperToken: TEST_DEVELOPER_TOKEN
        } as any);
      }).toThrow('paymentDestination is required');
    });

    it('should throw an error if atxpDeveloperToken is missing', () => {
      const paymentDestination = new ChainPaymentDestination('testDestination', 'base');

      expect(() => {
        buildServerConfig({
          paymentDestination
        } as any);
      }).toThrow('atxpDeveloperToken is required');
    });
  });

  describe('minimumPayment validation', () => {
    it('should throw an error if minimumPayment exceeds $1.00', () => {
      const paymentDestination = new ChainPaymentDestination('testDestination', 'base');

      expect(() => {
        buildServerConfig({
          paymentDestination,
          atxpDeveloperToken: TEST_DEVELOPER_TOKEN,
          minimumPayment: BigNumber(1.01) // $1.01, should throw
        });
      }).toThrow('minimumPayment cannot exceed $1.00');

      expect(() => {
        buildServerConfig({
          paymentDestination,
          atxpDeveloperToken: TEST_DEVELOPER_TOKEN,
          minimumPayment: BigNumber(5) // $5.00, should throw
        });
      }).toThrow('minimumPayment cannot exceed $1.00');
    });

    it('should allow minimumPayment of exactly $1.00', () => {
      const paymentDestination = new ChainPaymentDestination('testDestination', 'base');

      expect(() => {
        buildServerConfig({
          paymentDestination,
          atxpDeveloperToken: TEST_DEVELOPER_TOKEN,
          minimumPayment: BigNumber(1) // $1.00, should be allowed
        });
      }).not.toThrow();
    });

    it('should allow minimumPayment less than $1.00', () => {
      const paymentDestination = new ChainPaymentDestination('testDestination', 'base');

      expect(() => {
        buildServerConfig({
          paymentDestination,
          atxpDeveloperToken: TEST_DEVELOPER_TOKEN,
          minimumPayment: BigNumber(0.05) // $0.05, should be allowed
        });
      }).not.toThrow();

      expect(() => {
        buildServerConfig({
          paymentDestination,
          atxpDeveloperToken: TEST_DEVELOPER_TOKEN,
          minimumPayment: BigNumber(0.99) // $0.99, should be allowed
        });
      }).not.toThrow();
    });

    it('should allow no minimumPayment', () => {
      const paymentDestination = new ChainPaymentDestination('testDestination', 'base');

      expect(() => {
        buildServerConfig({
          paymentDestination,
          atxpDeveloperToken: TEST_DEVELOPER_TOKEN
          // No minimumPayment provided
        });
      }).not.toThrow();
    });
  });
});