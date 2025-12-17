import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPFetcher } from './atxpFetcher.js';
import { InsufficientFundsError, PaymentNetworkError } from './errors.js';
import type { ProspectivePayment } from './types.js';
import { BigNumber } from 'bignumber.js';

// Mock dependencies
vi.mock('./oAuth.js', () => ({
  OAuthClient: vi.fn(() => ({
    fetch: vi.fn(),
  })),
}));

vi.mock('@atxp/common', async () => {
  const actual = await vi.importActual('@atxp/common');
  return {
    ...actual,
    ConsoleLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  };
});

describe('Default Payment Failure Handler', () => {
  let mockLogger: any;
  let defaultHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Create an ATXPFetcher instance to access the default handler
    const account = {
      getAccountId: async () => 'test-account' as any,
      paymentMakers: [],
      getSources: async () => []
    };

    const fetcher = new ATXPFetcher({
      account,
      db: {} as any,
      destinationMakers: new Map(),
      logger: mockLogger,
    });

    // Access the private default handler
    defaultHandler = (fetcher as any).defaultPaymentFailureHandler;
  });

  const createTestPayment = (overrides: Partial<ProspectivePayment> = {}): ProspectivePayment => ({
    accountId: 'test-account-123',
    resourceUrl: 'https://example.com/resource',
    resourceName: 'test-resource',
    currency: 'USDC',
    amount: new BigNumber('10'),
    iss: 'test-issuer',
    ...overrides,
  });

  const createTestContext = (payment: ProspectivePayment, error: Error, overrides: Partial<any> = {}): any => ({
    payment,
    error,
    attemptedNetworks: ['base'],
    failureReasons: new Map([['base', error]]),
    retryable: false,
    timestamp: new Date(),
    ...overrides,
  });

  describe('InsufficientFundsError handling', () => {
    it('should log comprehensive insufficient funds information', async () => {
      const payment = createTestPayment({
        currency: 'USDC',
        amount: new BigNumber('25.5'),
        accountId: 'user-wallet-123',
      });

      const error = new InsufficientFundsError(
        'USDC',
        new BigNumber('25.5'),
        new BigNumber('10.75'),
        'solana'
      );

      await defaultHandler(createTestContext(payment, error, { attemptedNetworks: ['solana'], retryable: true }));

      // Check that key information is logged
      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('PAYMENT FAILED');
      expect(logOutput).toContain('Insufficient');
      expect(logOutput).toContain('solana');
      expect(logOutput).toContain('Required: 25.5 USDC');
      expect(logOutput).toContain('Available: 10.75 USDC');
      expect(logOutput).toContain('user-wallet-123');
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle insufficient funds error without available balance', async () => {
      const payment = createTestPayment({
        currency: 'USDC',
        amount: new BigNumber('100'),
        accountId: 'enterprise-account',
      });

      const error = new InsufficientFundsError(
        'USDC',
        new BigNumber('100'),
        undefined, // No available balance info
        'base'
      );

      await defaultHandler(createTestContext(payment, error));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('Required: 100 USDC');
      expect(logOutput).toContain('enterprise-account');

      // Should not log available balance
      expect(logOutput).not.toContain('Available:');
    });

    it('should handle different currencies and amounts', async () => {
      const payment = createTestPayment({
        currency: 'ETH' as any,
        amount: new BigNumber('2.5'),
        accountId: 'trader-123',
      });

      const error = new InsufficientFundsError(
        'ETH' as any,
        new BigNumber('2.5'),
        new BigNumber('0.001'),
        'ethereum'
      );

      await defaultHandler(createTestContext(payment, error, { attemptedNetworks: ['ethereum'], retryable: true }));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('ethereum');
      expect(logOutput).toContain('Required: 2.5 ETH');
      expect(logOutput).toContain('Available: 0.001 ETH');
      expect(logOutput).toContain('trader-123');
    });

    it('should use info level, not error level', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'), new BigNumber('5'));

      await defaultHandler(createTestContext(payment, error));

      // Verify using info level
      expect(mockLogger.info).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should log actionable guidance for insufficient funds', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'), new BigNumber('5'), 'base');

      await defaultHandler(createTestContext(payment, error, { attemptedNetworks: ['base'], retryable: true }));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('What to do:');
      expect(logOutput).toContain('wallet');
    });
  });

  describe('PaymentNetworkError handling', () => {
    it('should log network error with payment details', async () => {
      const payment = createTestPayment({
        currency: 'USDC',
        accountId: 'mobile-user-456',
      });

      const error = new PaymentNetworkError('RPC connection timeout');

      await defaultHandler(createTestContext(payment, error, { retryable: true }));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('PAYMENT FAILED');
      expect(logOutput).toContain('Network');
      expect(logOutput).toContain('mobile-user-456');
    });

    it('should include original error message in log', async () => {
      const payment = createTestPayment();
      const originalError = new Error('Connection refused');
      const error = new PaymentNetworkError('Network unavailable', originalError);

      await defaultHandler(createTestContext(payment, error));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('Network unavailable');
    });
  });

  describe('Generic error handling', () => {
    it('should log generic errors with basic message', async () => {
      const payment = createTestPayment({
        accountId: 'test-user',
      });

      const error = new Error('Unexpected payment failure');

      await defaultHandler(createTestContext(payment, error));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('PAYMENT FAILED');
      expect(logOutput).toContain('Unexpected payment failure');
      expect(logOutput).toContain('test-user');
    });

    it('should handle errors without message', async () => {
      const payment = createTestPayment();
      const error = new Error(); // Empty error message

      await defaultHandler(createTestContext(payment, error));

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('Attempted networks logging', () => {
    it('should log attempted networks when present', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'));

      await defaultHandler(createTestContext(payment, error, {
        attemptedNetworks: ['base', 'solana']
      }));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('Attempted networks: base, solana');
    });

    it('should not log attempted networks when empty', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'));

      await defaultHandler(createTestContext(payment, error, {
        attemptedNetworks: []
      }));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).not.toContain('Attempted networks');
    });
  });

  describe('Retryable flag', () => {
    it('should log retry message when retryable is true', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'));

      await defaultHandler(createTestContext(payment, error, {
        retryable: true
      }));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).toContain('retried');
    });

    it('should not log retry message when retryable is false', async () => {
      const payment = createTestPayment();
      const error = new Error('Fatal error');

      await defaultHandler(createTestContext(payment, error, {
        retryable: false
      }));

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);
      const logOutput = logCalls.join('\n');

      expect(logOutput).not.toContain('retried');
    });
  });

  describe('Message formatting', () => {
    it('should not include emojis in log messages', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'), new BigNumber('5'));

      await defaultHandler(createTestContext(payment, error));

      // Check that no emoji characters are in the logged messages
      const logCalls = mockLogger.info.mock.calls;
      logCalls.forEach((call: any[]) => {
        const message = call[0];
        expect(message).not.toMatch(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u);
      });
    });
  });
});
