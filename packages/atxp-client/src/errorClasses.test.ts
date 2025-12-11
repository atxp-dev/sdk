import { describe, it, expect } from 'vitest';
import { InsufficientFundsError, PaymentNetworkError } from './errors.js';
import { BigNumber } from 'bignumber.js';

describe('InsufficientFundsError', () => {
  it('should create error with all properties and full message', () => {
    const error = new InsufficientFundsError(
      'USDC',
      new BigNumber('10.5'),
      new BigNumber('5.25'),
      'solana'
    );
    
    expect(error.name).toBe('InsufficientFundsError');
    expect(error.currency).toBe('USDC');
    expect(error.required.toString()).toBe('10.5');
    expect(error.available?.toString()).toBe('5.25');
    expect(error.network).toBe('solana');
    expect(error.message).toBe(
      'Payment failed due to insufficient USDC funds on solana. Required: 10.5, Available: 5.25. Please ensure your account has adequate balance before retrying.'
    );
  });

  it('should work without available amount', () => {
    const error = new InsufficientFundsError(
      'USDC',
      new BigNumber('100'),
      undefined,
      'base'
    );
    
    expect(error.message).toBe(
      'Payment failed due to insufficient USDC funds on base. Required: 100. Please ensure your account has adequate balance before retrying.'
    );
    expect(error.available).toBeUndefined();
  });

  it('should work without network', () => {
    const error = new InsufficientFundsError(
      'USDC' as const,
      new BigNumber('1.5'),
      new BigNumber('0.8')
    );
    
    expect(error.message).toBe(
      'Payment failed due to insufficient USDC funds. Required: 1.5, Available: 0.8. Please ensure your account has adequate balance before retrying.'
    );
    expect(error.network).toBeUndefined();
  });

  it('should work with minimal parameters', () => {
    const error = new InsufficientFundsError(
      'USDC' as const,
      new BigNumber('0.001')
    );
    
    expect(error.message).toBe(
      'Payment failed due to insufficient USDC funds. Required: 0.001. Please ensure your account has adequate balance before retrying.'
    );
    expect(error.available).toBeUndefined();
    expect(error.network).toBeUndefined();
  });

  it('should be instanceof Error and InsufficientFundsError', () => {
    const error = new InsufficientFundsError('USDC', new BigNumber('10'));
    
    expect(error instanceof Error).toBe(true);
    expect(error instanceof InsufficientFundsError).toBe(true);
  });
});

describe('PaymentNetworkError', () => {
  it('should create error with original error', () => {
    const originalError = new Error('Connection timeout');
    const error = new PaymentNetworkError('Network failed', originalError);
    
    expect(error.name).toBe('PaymentNetworkError');
    expect(error.message).toBe(
      'Payment failed due to network error: Network failed'
    );
    expect(error.originalError).toBe(originalError);
  });

  it('should work without original error', () => {
    const error = new PaymentNetworkError('Transaction reverted');
    
    expect(error.name).toBe('PaymentNetworkError');
    expect(error.message).toBe(
      'Payment failed due to network error: Transaction reverted'
    );
    expect(error.originalError).toBeUndefined();
  });

  it('should be instanceof Error and PaymentNetworkError', () => {
    const error = new PaymentNetworkError('Test error');
    
    expect(error instanceof Error).toBe(true);
    expect(error instanceof PaymentNetworkError).toBe(true);
  });

  it('should preserve original error stack trace', () => {
    const originalError = new Error('Original error');
    const networkError = new PaymentNetworkError('Wrapped', originalError);
    
    expect(networkError.originalError?.stack).toBe(originalError.stack);
    expect(networkError.originalError?.message).toBe('Original error');
  });
});