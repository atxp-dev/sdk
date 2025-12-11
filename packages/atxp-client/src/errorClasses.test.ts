import { describe, it, expect } from 'vitest';
import {
  ATXPPaymentError,
  InsufficientFundsError,
  TransactionRevertedError,
  UnsupportedCurrencyError,
  GasEstimationError,
  RpcError,
  UserRejectedError,
  PaymentServerError,
  PaymentExpiredError,
  PaymentNetworkError
} from './errors.js';
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
    const error = new PaymentNetworkError('base', 'Network failed', originalError);

    expect(error.name).toBe('PaymentNetworkError');
    expect(error.network).toBe('base');
    expect(error.message).toBe('Payment failed on base network: Network failed');
    expect(error.originalError).toBe(originalError);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.retryable).toBe(true);
  });

  it('should work without original error', () => {
    const error = new PaymentNetworkError('solana', 'Transaction reverted');

    expect(error.name).toBe('PaymentNetworkError');
    expect(error.message).toBe('Payment failed on solana network: Transaction reverted');
    expect(error.originalError).toBeUndefined();
  });

  it('should be instanceof Error and PaymentNetworkError', () => {
    const error = new PaymentNetworkError('base', 'Test error');

    expect(error instanceof Error).toBe(true);
    expect(error instanceof PaymentNetworkError).toBe(true);
  });

  it('should preserve original error stack trace', () => {
    const originalError = new Error('Original error');
    const networkError = new PaymentNetworkError('base', 'Wrapped', originalError);

    expect(networkError.originalError?.stack).toBe(originalError.stack);
    expect(networkError.originalError?.message).toBe('Original error');
  });
});

describe('TransactionRevertedError', () => {
  it('should create error with transaction hash and network', () => {
    const error = new TransactionRevertedError('0x123abc', 'base');

    expect(error.name).toBe('TransactionRevertedError');
    expect(error.code).toBe('TRANSACTION_REVERTED');
    expect(error.transactionHash).toBe('0x123abc');
    expect(error.network).toBe('base');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Transaction 0x123abc reverted on base');
  });

  it('should include revert reason in message', () => {
    const error = new TransactionRevertedError('0x456def', 'solana', 'insufficient allowance');

    expect(error.message).toBe('Transaction 0x456def reverted on solana: insufficient allowance');
    expect(error.revertReason).toBe('insufficient allowance');
  });

  it('should provide specific actionable message for allowance issues', () => {
    const error = new TransactionRevertedError('0x789', 'base', 'ERC20: insufficient allowance');

    expect(error.actionableMessage).toContain('Approve token spending');
    expect(error.actionableMessage).toContain('allowance');
  });

  it('should provide specific actionable message for balance issues', () => {
    const error = new TransactionRevertedError('0x789', 'base', 'insufficient balance for transfer');

    expect(error.actionableMessage).toContain('sufficient token balance');
    expect(error.actionableMessage).toContain('gas fees');
  });

  it('should provide generic actionable message for unknown revert reasons', () => {
    const error = new TransactionRevertedError('0x789', 'base', 'unknown error');

    expect(error.actionableMessage).toContain('Check the transaction details');
    expect(error.actionableMessage).toContain('block explorer');
  });
});

describe('UnsupportedCurrencyError', () => {
  it('should create error with currency and network info', () => {
    const error = new UnsupportedCurrencyError('DAI', 'base', ['USDC']);

    expect(error.name).toBe('UnsupportedCurrencyError');
    expect(error.code).toBe('UNSUPPORTED_CURRENCY');
    expect(error.currency).toBe('DAI');
    expect(error.network).toBe('base');
    expect(error.supportedCurrencies).toEqual(['USDC']);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Currency DAI is not supported on base');
  });

  it('should list all supported currencies in actionable message', () => {
    const error = new UnsupportedCurrencyError('ETH', 'solana', ['USDC', 'SOL']);

    expect(error.actionableMessage).toContain('USDC, SOL');
  });
});

describe('GasEstimationError', () => {
  it('should create error with network', () => {
    const error = new GasEstimationError('base');

    expect(error.name).toBe('GasEstimationError');
    expect(error.code).toBe('GAS_ESTIMATION_FAILED');
    expect(error.network).toBe('base');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Failed to estimate gas on base');
  });

  it('should include reason when provided', () => {
    const error = new GasEstimationError('base', 'transaction would revert');

    expect(error.message).toBe('Failed to estimate gas on base: transaction would revert');
    expect(error.reason).toBe('transaction would revert');
  });

  it('should provide actionable message about gas and fees', () => {
    const error = new GasEstimationError('base');

    expect(error.actionableMessage).toContain('gas');
    expect(error.actionableMessage).toContain('fees');
  });
});

describe('RpcError', () => {
  it('should create error with network', () => {
    const error = new RpcError('base');

    expect(error.name).toBe('RpcError');
    expect(error.code).toBe('RPC_ERROR');
    expect(error.network).toBe('base');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('RPC call failed on base');
  });

  it('should include RPC URL when provided', () => {
    const error = new RpcError('base', 'https://rpc.base.org');

    expect(error.message).toBe('RPC call failed on base (https://rpc.base.org)');
    expect(error.rpcUrl).toBe('https://rpc.base.org');
  });

  it('should include original error', () => {
    const originalError = new Error('Network timeout');
    const error = new RpcError('solana', 'https://api.mainnet-beta.solana.com', originalError);

    expect(error.originalError).toBe(originalError);
    expect(error.context?.originalError).toBe('Network timeout');
  });

  it('should provide actionable message about connectivity', () => {
    const error = new RpcError('base');

    expect(error.actionableMessage).toContain('internet connection');
  });
});

describe('UserRejectedError', () => {
  it('should create error with network', () => {
    const error = new UserRejectedError('base');

    expect(error.name).toBe('UserRejectedError');
    expect(error.code).toBe('USER_REJECTED');
    expect(error.network).toBe('base');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('User rejected transaction on base');
  });

  it('should provide actionable message about wallet approval', () => {
    const error = new UserRejectedError('solana');

    expect(error.actionableMessage).toContain('approve the transaction');
    expect(error.actionableMessage).toContain('wallet');
  });
});

describe('PaymentServerError', () => {
  it('should create error with status code and endpoint', () => {
    const error = new PaymentServerError(500, '/charge');

    expect(error.name).toBe('PaymentServerError');
    expect(error.code).toBe('PAYMENT_SERVER_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.endpoint).toBe('/charge');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Payment server returned 500 from /charge');
  });

  it('should include server message when provided', () => {
    const error = new PaymentServerError(400, '/charge', 'Invalid request body');

    expect(error.message).toBe('Payment server returned 400 from /charge: Invalid request body');
    expect(error.serverMessage).toBe('Invalid request body');
  });

  it('should use custom error code when provided', () => {
    const error = new PaymentServerError(402, '/charge', 'Insufficient balance', 'INSUFFICIENT_BALANCE');

    expect(error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('should include details in context', () => {
    const details = { required: '100', available: '50' };
    const error = new PaymentServerError(402, '/charge', 'Insufficient balance', 'INSUFFICIENT_BALANCE', details);

    expect(error.details).toEqual(details);
    expect(error.context?.details).toEqual(details);
  });
});

describe('PaymentExpiredError', () => {
  it('should create error with payment request ID', () => {
    const error = new PaymentExpiredError('req_123');

    expect(error.name).toBe('PaymentExpiredError');
    expect(error.code).toBe('PAYMENT_EXPIRED');
    expect(error.paymentRequestId).toBe('req_123');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Payment request req_123 has expired');
  });

  it('should include expiration date when provided', () => {
    const expiresAt = new Date('2024-01-01');
    const error = new PaymentExpiredError('req_456', expiresAt);

    expect(error.expiresAt).toBe(expiresAt);
    expect(error.context?.expiresAt).toBe(expiresAt.toISOString());
  });

  it('should provide actionable message about making new request', () => {
    const error = new PaymentExpiredError('req_123');

    expect(error.actionableMessage).toContain('new request');
  });
});

describe('ATXPPaymentError base class', () => {
  it('should have structured properties on all error types', () => {
    const errors = [
      new InsufficientFundsError('USDC', new BigNumber('10')),
      new TransactionRevertedError('0x123', 'base'),
      new UnsupportedCurrencyError('DAI', 'base', ['USDC']),
      new GasEstimationError('base'),
      new RpcError('base'),
      new UserRejectedError('base'),
      new PaymentServerError(500, '/charge'),
      new PaymentExpiredError('req_123'),
      new PaymentNetworkError('base', 'error')
    ];

    errors.forEach(error => {
      expect(error).toBeInstanceOf(ATXPPaymentError);
      expect(error).toBeInstanceOf(Error);
      expect(typeof error.code).toBe('string');
      expect(typeof error.retryable).toBe('boolean');
      expect(typeof error.actionableMessage).toBe('string');
      expect(error.name).toBeTruthy();
      expect(error.message).toBeTruthy();
    });
  });

  it('should include context in all errors', () => {
    const error1 = new InsufficientFundsError('USDC', new BigNumber('10'), new BigNumber('5'), 'base');
    expect(error1.context).toBeDefined();
    expect(error1.context?.network).toBe('base');

    const error2 = new TransactionRevertedError('0x123', 'base', 'revert reason');
    expect(error2.context).toBeDefined();
    expect(error2.context?.transactionHash).toBe('0x123');

    const error3 = new RpcError('base', 'https://rpc.base.org');
    expect(error3.context).toBeDefined();
    expect(error3.context?.rpcUrl).toBe('https://rpc.base.org');
  });
});