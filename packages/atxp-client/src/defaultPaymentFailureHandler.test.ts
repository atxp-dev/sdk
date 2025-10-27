import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPFetcher } from './atxpFetcher.js';
import { InsufficientFundsError, PaymentNetworkError, ProspectivePayment } from './types.js';
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
      accountId: 'test-account' as any,
      paymentMakers: [],
      getSources: () => []
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

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledTimes(4);
      expect(mockLogger.info).toHaveBeenCalledWith('PAYMENT FAILED: Insufficient USDC funds on solana');
      expect(mockLogger.info).toHaveBeenCalledWith('Required: 25.5 USDC');
      expect(mockLogger.info).toHaveBeenCalledWith('Available: 10.75 USDC');
      expect(mockLogger.info).toHaveBeenCalledWith('Account: user-wallet-123');
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

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledTimes(3);
      expect(mockLogger.info).toHaveBeenCalledWith('PAYMENT FAILED: Insufficient USDC funds on base');
      expect(mockLogger.info).toHaveBeenCalledWith('Required: 100 USDC');
      expect(mockLogger.info).toHaveBeenCalledWith('Account: enterprise-account');

      // Should not log available balance
      expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('Available:'));
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

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith('PAYMENT FAILED: Insufficient ETH funds on ethereum');
      expect(mockLogger.info).toHaveBeenCalledWith('Required: 2.5 ETH');
      expect(mockLogger.info).toHaveBeenCalledWith('Available: 0.001 ETH');
      expect(mockLogger.info).toHaveBeenCalledWith('Account: trader-123');
    });

    it('should use info level, not error level', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'), new BigNumber('5'));

      await defaultHandler({ payment, error });

      // Verify using info level
      expect(mockLogger.info).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('PaymentNetworkError handling', () => {
    it('should log network error with payment details', async () => {
      const payment = createTestPayment({
        currency: 'USDC',
        accountId: 'mobile-user-456',
      });

      const error = new PaymentNetworkError('RPC connection timeout');

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PAYMENT FAILED: Network error')
      );
    });

    it('should handle network error with different networks', async () => {
      const payment = createTestPayment();

      const error = new PaymentNetworkError('Transaction reverted');

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PAYMENT FAILED: Network error')
      );
    });

    it('should include original error message in log', async () => {
      const payment = createTestPayment();
      const originalError = new Error('Connection refused');
      const error = new PaymentNetworkError('Network unavailable', originalError);

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Network unavailable')
      );
    });
  });

  describe('Generic error handling', () => {
    it('should log generic errors with basic message', async () => {
      const payment = createTestPayment({
        accountId: 'test-user',
      });

      const error = new Error('Unexpected payment failure');

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith('PAYMENT FAILED: Unexpected payment failure');
    });

    it('should handle errors without message', async () => {
      const payment = createTestPayment();
      const error = new Error(); // Empty error message

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith('PAYMENT FAILED: ');
    });

    it('should handle null/undefined error message', async () => {
      const payment = createTestPayment();
      const error = { message: null } as any;

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith('PAYMENT FAILED: null');
    });
  });

  describe('Message formatting', () => {
    it('should not include emojis in log messages', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('10'), new BigNumber('5'));

      await defaultHandler({ payment, error });

      // Check that no emoji characters are in the logged messages
      const logCalls = mockLogger.info.mock.calls;
      logCalls.forEach((call: any[]) => {
        const message = call[0];
        expect(message).not.toMatch(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u);
      });
    });

    it('should format messages for text-only logs', async () => {
      const payment = createTestPayment();
      const error = new InsufficientFundsError('USDC', new BigNumber('100'), new BigNumber('50'), 'solana');

      await defaultHandler({ payment, error });

      const logCalls = mockLogger.info.mock.calls.map((call: any[]) => call[0]);

      expect(logCalls).toEqual([
        'PAYMENT FAILED: Insufficient USDC funds on solana',
        'Required: 100 USDC',
        'Available: 50 USDC',
        'Account: test-account-123',
      ]);
    });

    it('should be parseable by log aggregation tools', async () => {
      const payment = createTestPayment({
        accountId: 'user-123',
      });
      const error = new PaymentNetworkError('Connection timeout');

      await defaultHandler({ payment, error });

      // Verify messages follow structured format
      expect(mockLogger.info).toHaveBeenCalledWith(
        'PAYMENT FAILED: Network error: Payment failed due to network error: Connection timeout'
      );
    });
  });

  describe('Integration with different payment types', () => {
    it('should handle small decimal amounts correctly', async () => {
      const payment = createTestPayment({
        amount: new BigNumber('0.000001'),
        currency: 'USDC' as const,
      });

      const error = new InsufficientFundsError(
        'USDC' as const,
        new BigNumber('0.000001'),
        new BigNumber('0.0000005'),
        'bitcoin'
      );

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith('Required: 0.000001 USDC');
      expect(mockLogger.info).toHaveBeenCalledWith('Available: 5e-7 USDC');
    });

    it('should handle large amounts correctly', async () => {
      const payment = createTestPayment({
        amount: new BigNumber('1000000'),
        currency: 'USDC',
      });

      const error = new InsufficientFundsError(
        'USDC',
        new BigNumber('1000000'),
        new BigNumber('999999.99'),
        'solana'
      );

      await defaultHandler({ payment, error });

      expect(mockLogger.info).toHaveBeenCalledWith('Required: 1000000 USDC');
      expect(mockLogger.info).toHaveBeenCalledWith('Available: 999999.99 USDC');
    });
  });
});