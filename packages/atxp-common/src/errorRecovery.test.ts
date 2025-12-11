import { describe, it, expect } from 'vitest';
import {
  getErrorRecoveryHint,
  captureErrorTelemetry,
  isRecoverableError,
  type ErrorRecoveryHint,
  type ErrorTelemetry
} from './errorRecovery.js';

// Mock error classes for testing
class MockRecoverableError extends Error implements {
  code: string;
  retryable: boolean;
  actionableMessage: string;
  context?: Record<string, any>;
} {
  code: string;
  retryable: boolean;
  actionableMessage: string;
  context?: Record<string, any>;

  constructor(code: string, message: string, retryable: boolean, actionableMessage: string, context?: Record<string, any>) {
    super(message);
    this.name = 'MockRecoverableError';
    this.code = code;
    this.retryable = retryable;
    this.actionableMessage = actionableMessage;
    this.context = context;
  }
}

describe('isRecoverableError', () => {
  it('should return true for errors with all required fields', () => {
    const error = new MockRecoverableError('TEST_ERROR', 'Test message', true, 'Do this');

    expect(isRecoverableError(error)).toBe(true);
  });

  it('should return false for standard Error objects', () => {
    const error = new Error('Standard error');

    expect(isRecoverableError(error)).toBe(false);
  });

  it('should return false for non-Error objects', () => {
    expect(isRecoverableError(null)).toBe(false);
    expect(isRecoverableError(undefined)).toBe(false);
    expect(isRecoverableError('string')).toBe(false);
    expect(isRecoverableError({})).toBe(false);
  });
});

describe('getErrorRecoveryHint', () => {
  it('should generate hint for recoverable error', () => {
    const error = new MockRecoverableError(
      'INSUFFICIENT_FUNDS',
      'Not enough USDC',
      true,
      'Add at least 10 USDC to your wallet',
      { network: 'base', required: '10', available: '5' }
    );

    const hint = getErrorRecoveryHint(error);

    expect(hint.title).toBe('Mock Recoverable');
    expect(hint.description).toBe('Not enough USDC');
    expect(hint.actions).toContain('Add at least 10 USDC to your wallet');
    expect(hint.retryable).toBe(true);
    expect(hint.code).toBe('INSUFFICIENT_FUNDS');
    expect(hint.supportLink).toBe('https://docs.atxp.ai/wallets/base');
  });

  it('should add specific actions for INSUFFICIENT_FUNDS error', () => {
    const error = new MockRecoverableError(
      'INSUFFICIENT_FUNDS',
      'Not enough funds',
      true,
      'Add more funds',
      { network: 'solana' }
    );

    const hint = getErrorRecoveryHint(error);

    expect(hint.actions.length).toBeGreaterThan(1);
    expect(hint.actions).toContain('Add more funds');
    expect(hint.actions.some(action => action.includes('Bridge tokens'))).toBe(true);
    expect(hint.supportLink).toContain('/wallets/solana');
  });

  it('should add block explorer link for TRANSACTION_REVERTED error', () => {
    const error = new MockRecoverableError(
      'TRANSACTION_REVERTED',
      'Transaction failed',
      false,
      'Check transaction',
      { network: 'base', transactionHash: '0x123abc' }
    );

    const hint = getErrorRecoveryHint(error);

    expect(hint.actions.some(action => action.includes('block explorer'))).toBe(true);
    expect(hint.supportLink).toContain('basescan.org/tx/0x123abc');
  });

  it('should add specific actions for RPC_ERROR', () => {
    const error = new MockRecoverableError(
      'RPC_ERROR',
      'Network error',
      true,
      'Check connection',
      { network: 'base' }
    );

    const hint = getErrorRecoveryHint(error);

    expect(hint.actions.length).toBeGreaterThan(1);
    expect(hint.actions.some(action => action.includes('internet connection'))).toBe(true);
    expect(hint.actions.some(action => action.includes('RPC endpoint'))).toBe(true);
  });

  it('should add specific actions for GAS_ESTIMATION_FAILED error', () => {
    const error = new MockRecoverableError(
      'GAS_ESTIMATION_FAILED',
      'Cannot estimate gas',
      true,
      'Check gas',
      { network: 'base' }
    );

    const hint = getErrorRecoveryHint(error);

    expect(hint.actions.length).toBeGreaterThan(1);
    expect(hint.actions.some(action => action.includes('native tokens for gas'))).toBe(true);
  });

  it('should add specific actions for USER_REJECTED error', () => {
    const error = new MockRecoverableError(
      'USER_REJECTED',
      'User cancelled',
      true,
      'Approve in wallet',
      { network: 'base' }
    );

    const hint = getErrorRecoveryHint(error);

    expect(hint.actions.length).toBeGreaterThan(1);
    expect(hint.actions.some(action => action.includes('transaction details'))).toBe(true);
  });

  it('should add specific actions for UNSUPPORTED_CURRENCY error', () => {
    const error = new MockRecoverableError(
      'UNSUPPORTED_CURRENCY',
      'Currency not supported',
      false,
      'Use supported currency',
      { network: 'base' }
    );

    const hint = getErrorRecoveryHint(error);

    expect(hint.actions.length).toBeGreaterThan(1);
    expect(hint.actions.some(action => action.includes('supported currencies'))).toBe(true);
  });

  it('should provide fallback for generic errors', () => {
    const error = new Error('Generic error message');

    const hint = getErrorRecoveryHint(error);

    expect(hint.title).toBe('Payment Error');
    expect(hint.description).toBe('Generic error message');
    expect(hint.actions).toContain('Please try again or contact support if the issue persists');
    expect(hint.retryable).toBe(false);
    expect(hint.supportLink).toContain('/support');
  });

  it('should use custom base URL for support links', () => {
    const error = new MockRecoverableError('TEST_ERROR', 'Test', true, 'Action');
    const customUrl = 'https://custom.docs.com';

    const hint = getErrorRecoveryHint(error, customUrl);

    expect(hint.supportLink).toContain(customUrl);
  });
});

describe('captureErrorTelemetry', () => {
  it('should capture basic telemetry from recoverable error', () => {
    const error = new MockRecoverableError(
      'TEST_ERROR',
      'Test message',
      true,
      'Do this',
      { foo: 'bar' }
    );

    const telemetry = captureErrorTelemetry(error, { userId: '123' });

    expect(telemetry.errorCode).toBe('TEST_ERROR');
    expect(telemetry.errorType).toBe('MockRecoverableError');
    expect(telemetry.timestamp).toBeTruthy();
    expect(telemetry.context.message).toBe('Test message');
    expect(telemetry.context.userId).toBe('123');
    expect(telemetry.context.foo).toBe('bar');
  });

  it('should capture network from context', () => {
    const error = new MockRecoverableError(
      'RPC_ERROR',
      'Network error',
      true,
      'Action',
      { network: 'base' }
    );

    const telemetry = captureErrorTelemetry(error);

    expect(telemetry.network).toBe('base');
  });

  it('should capture currency and amount from context', () => {
    const error = new MockRecoverableError(
      'INSUFFICIENT_FUNDS',
      'Not enough',
      true,
      'Action',
      { currency: 'USDC', required: '100' }
    );

    const telemetry = captureErrorTelemetry(error);

    expect(telemetry.currency).toBe('USDC');
    expect(telemetry.amount).toBe('100');
  });

  it('should capture transaction hash from context', () => {
    const error = new MockRecoverableError(
      'TRANSACTION_REVERTED',
      'Reverted',
      false,
      'Action',
      { transactionHash: '0x123abc' }
    );

    const telemetry = captureErrorTelemetry(error);

    expect(telemetry.transactionHash).toBe('0x123abc');
  });

  it('should capture RPC URL from context', () => {
    const error = new MockRecoverableError(
      'RPC_ERROR',
      'Network error',
      true,
      'Action',
      { rpcUrl: 'https://rpc.base.org' }
    );

    const telemetry = captureErrorTelemetry(error);

    expect(telemetry.rpcUrl).toBe('https://rpc.base.org');
  });

  it('should handle generic errors with UNKNOWN code', () => {
    const error = new Error('Generic error');

    const telemetry = captureErrorTelemetry(error);

    expect(telemetry.errorCode).toBe('UNKNOWN');
    expect(telemetry.errorType).toBe('Error');
    expect(telemetry.context.message).toBe('Generic error');
  });

  it('should include stack trace in context', () => {
    const error = new Error('Test error');

    const telemetry = captureErrorTelemetry(error);

    expect(telemetry.context.stack).toBeTruthy();
    expect(typeof telemetry.context.stack).toBe('string');
  });

  it('should merge additional context', () => {
    const error = new MockRecoverableError('TEST', 'Message', true, 'Action', { original: 'data' });

    const telemetry = captureErrorTelemetry(error, {
      userId: '123',
      sessionId: 'abc',
      requestId: 'req-456'
    });

    expect(telemetry.context.original).toBe('data');
    expect(telemetry.context.userId).toBe('123');
    expect(telemetry.context.sessionId).toBe('abc');
    expect(telemetry.context.requestId).toBe('req-456');
  });

  it('should create valid ISO timestamp', () => {
    const error = new Error('Test');

    const telemetry = captureErrorTelemetry(error);

    const timestamp = new Date(telemetry.timestamp);
    expect(timestamp).toBeInstanceOf(Date);
    expect(isNaN(timestamp.getTime())).toBe(false);
  });
});
