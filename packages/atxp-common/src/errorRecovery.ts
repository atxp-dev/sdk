/**
 * Error recovery guidance for ATXP payment errors
 *
 * This module provides structured error recovery hints to help users
 * understand what went wrong and how to fix it.
 */

/**
 * Structured recovery guidance for payment errors
 */
export interface ErrorRecoveryHint {
  /** Short title describing the error type */
  title: string;
  /** Detailed description of what went wrong */
  description: string;
  /** Specific actions the user can take to resolve the issue */
  actions: string[];
  /** Whether retrying the operation makes sense */
  retryable: boolean;
  /** Optional link to relevant documentation or support */
  supportLink?: string;
  /** Error code for programmatic handling */
  code?: string;
}

/**
 * Base interface for errors that provide recovery hints
 */
export interface RecoverableError extends Error {
  code: string;
  retryable: boolean;
  actionableMessage: string;
  context?: Record<string, unknown>;
}

/**
 * Type guard to check if an error is a recoverable error
 */
export function isRecoverableError(error: unknown): error is RecoverableError {
  return (
    error instanceof Error &&
    'code' in error &&
    'retryable' in error &&
    'actionableMessage' in error
  );
}

/**
 * Get structured recovery guidance for any payment error
 *
 * @param error - The error to analyze
 * @param baseUrl - Optional base URL for documentation links
 * @returns Structured recovery hint with actionable guidance
 *
 * @example
 * ```typescript
 * try {
 *   await makePayment(...);
 * } catch (error) {
 *   const hint = getErrorRecoveryHint(error);
 *   console.log(hint.title);        // "Insufficient Funds"
 *   console.log(hint.description);  // "Your base wallet needs more USDC"
 *   console.log(hint.actions);      // ["Add at least 10 USDC to your wallet"]
 *   console.log(hint.retryable);    // true
 * }
 * ```
 */
export function getErrorRecoveryHint(
  error: Error,
  baseUrl = 'https://docs.atxp.ai'
): ErrorRecoveryHint {
  // Handle recoverable errors with structured information
  if (isRecoverableError(error)) {
    const hint: ErrorRecoveryHint = {
      title: error.name.replace(/Error$/, '').replace(/([A-Z])/g, ' $1').trim(),
      description: error.message,
      actions: [error.actionableMessage],
      retryable: error.retryable,
      code: error.code,
      supportLink: `${baseUrl}/troubleshooting#${error.code.toLowerCase().replace(/_/g, '-')}`
    };

    // Add context-specific actions based on error code
    if (error.code === 'INSUFFICIENT_FUNDS' && error.context?.network) {
      const network = String(error.context.network);
      hint.actions.push(
        `Bridge tokens from another chain to ${network}`,
        'Check that you have enough for both the payment and gas fees'
      );
      hint.supportLink = `${baseUrl}/wallets/${network}`;
    } else if (error.code === 'TRANSACTION_REVERTED' && error.context?.transactionHash) {
      const network = error.context.network ? String(error.context.network) : 'ethereum';
      hint.actions.push('View transaction details on block explorer');
      hint.supportLink = getBlockExplorerUrl(network, String(error.context.transactionHash));
    } else if (error.code === 'RPC_ERROR') {
      hint.actions.push(
        'Verify your internet connection is stable',
        'Try using a different RPC endpoint if the issue persists',
        'The blockchain network may be experiencing high load'
      );
    } else if (error.code === 'GAS_ESTIMATION_FAILED') {
      hint.actions.push(
        'Ensure you have native tokens for gas fees',
        'Try increasing your gas limit manually',
        'Check if the recipient address is valid'
      );
    } else if (error.code === 'USER_REJECTED') {
      hint.actions.push(
        'Review the transaction details carefully',
        'Ensure you trust the destination address'
      );
    } else if (error.code === 'UNSUPPORTED_CURRENCY') {
      hint.actions.push(
        'Check the list of supported currencies for this network',
        'Convert your tokens to a supported currency'
      );
    }

    return hint;
  }

  // Fallback for generic errors
  return {
    title: 'Payment Error',
    description: error.message || 'An unknown error occurred',
    actions: ['Please try again or contact support if the issue persists'],
    retryable: false,
    supportLink: `${baseUrl}/support`
  };
}

/**
 * Get the appropriate block explorer URL for a transaction
 */
function getBlockExplorerUrl(network: string, txHash: string): string {
  const explorers: Record<string, string> = {
    'base': `https://basescan.org/tx/${txHash}`,
    'ethereum': `https://etherscan.io/tx/${txHash}`,
    'polygon': `https://polygonscan.com/tx/${txHash}`,
    'solana': `https://explorer.solana.com/tx/${txHash}`,
    'worldchain': `https://worldchain-mainnet.explorer.alchemy.com/tx/${txHash}`,
  };

  return explorers[network.toLowerCase()] || `https://etherscan.io/tx/${txHash}`;
}

/**
 * Format error telemetry data for logging and analytics
 */
export interface ErrorTelemetry {
  errorCode: string;
  errorType: string;
  network?: string;
  currency?: string;
  amount?: string;
  transactionHash?: string;
  rpcUrl?: string;
  timestamp: string;
  context: Record<string, unknown>;
}

/**
 * Capture structured telemetry data from an error
 *
 * @param error - The error to capture
 * @param additionalContext - Additional context to include
 * @returns Structured telemetry object
 *
 * @example
 * ```typescript
 * try {
 *   await makePayment(...);
 * } catch (error) {
 *   const telemetry = captureErrorTelemetry(error, { userId: '123' });
 *   logger.error('Payment failed', telemetry);
 * }
 * ```
 */
export function captureErrorTelemetry(
  error: Error,
  additionalContext?: Record<string, unknown>
): ErrorTelemetry {
  const telemetry: ErrorTelemetry = {
    errorCode: isRecoverableError(error) ? error.code : 'UNKNOWN',
    errorType: error.name,
    timestamp: new Date().toISOString(),
    context: {
      ...additionalContext,
      message: error.message,
      stack: error.stack
    }
  };

  // Extract specific fields from recoverable errors
  if (isRecoverableError(error) && error.context) {
    const ctx = error.context;

    if (ctx.network && typeof ctx.network === 'string') telemetry.network = ctx.network;
    if (ctx.currency && typeof ctx.currency === 'string') telemetry.currency = ctx.currency;
    if (ctx.required && typeof ctx.required === 'string') telemetry.amount = ctx.required;
    if (ctx.transactionHash && typeof ctx.transactionHash === 'string') telemetry.transactionHash = ctx.transactionHash;
    if (ctx.rpcUrl && typeof ctx.rpcUrl === 'string') telemetry.rpcUrl = ctx.rpcUrl;

    // Include all context data
    telemetry.context = { ...telemetry.context, ...ctx };
  }

  return telemetry;
}
