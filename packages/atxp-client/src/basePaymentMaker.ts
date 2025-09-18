import type { PaymentMaker, EIP3009Message } from './types.js';
import { InsufficientFundsError as InsufficientFundsErrorClass, PaymentNetworkError as PaymentNetworkErrorClass } from './types.js';
import { Logger, Currency } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';
import { BigNumber } from "bignumber.js";

// Helper function to convert to base64url that works in both Node.js and browsers
function toBase64Url(data: string): string {
  // Convert string to base64
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(data).toString('base64')
    : btoa(data);
  // Convert base64 to base64url
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export class BasePaymentMaker implements PaymentMaker {
  protected logger: Logger;
  private accountsServiceUrl: string;
  private authToken: string;

  constructor(accountsServiceUrl: string, authToken: string, logger?: Logger) {
    if (!accountsServiceUrl) {
      throw new Error('accountsServiceUrl was empty');
    }
    if (!authToken) {
      throw new Error('authToken was empty');
    }

    this.accountsServiceUrl = accountsServiceUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = authToken;
    this.logger = logger ?? new ConsoleLogger();
  }

  async generateJWT({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> {
    // Call the accounts service /sign endpoint to generate JWT
    const response = await fetch(`${this.accountsServiceUrl}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify({
        paymentRequestId,
        codeChallenge
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new PaymentNetworkErrorClass(`Failed to generate JWT: ${error}`);
    }

    const { jwt } = await response.json();
    this.logger.info(`Generated JWT from accounts service`);
    return jwt;
  }

  async makePayment(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<string> {
    if (currency.toUpperCase() !== 'USDC') {
      throw new PaymentNetworkErrorClass('Only USDC currency is supported; received ' + currency);
    }

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver}`);

    try {
      // Call the accounts service /pay endpoint for regular payments
      const response = await fetch(`${this.accountsServiceUrl}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          amount: amount.toString(),
          currency: currency.toUpperCase(),
          receiver,
          memo
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));

        // Check for insufficient funds error
        if (response.status === 400 && error.error?.includes('Insufficient balance')) {
          // Try to parse available balance from error response
          const match = error.error.match(/Available: ([\d.]+)/);
          const available = match ? new BigNumber(match[1]) : new BigNumber(0);
          throw new InsufficientFundsErrorClass(currency, amount, available, 'base');
        }

        throw new PaymentNetworkErrorClass(
          `Failed to make payment: ${error.error || response.statusText}`
        );
      }

      const { txHash } = await response.json();
      this.logger.info(`Payment completed: ${txHash}`);

      return txHash;
    } catch (error) {
      if (error instanceof InsufficientFundsErrorClass || error instanceof PaymentNetworkErrorClass) {
        throw error;
      }

      // Wrap other errors in PaymentNetworkError
      throw new PaymentNetworkErrorClass(
        `Failed to make payment: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  async createPaymentAuthorization(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<EIP3009Message> {
    if (currency.toUpperCase() !== 'USDC') {
      throw new PaymentNetworkErrorClass('Only USDC currency is supported; received ' + currency);
    }

    this.logger.info(`Creating EIP-3009 payment authorization for ${amount} ${currency} to ${receiver}`);

    try {
      // Call the accounts service /create-payment-authorization endpoint
      const response = await fetch(`${this.accountsServiceUrl}/create-payment-authorization`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          amount: amount.toString(),
          currency: currency.toUpperCase(),
          receiver,
          memo
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));

        // Check for insufficient funds error
        if (response.status === 400 && error.error?.includes('Insufficient balance')) {
          const available = new BigNumber(error.available || '0');
          throw new InsufficientFundsErrorClass(currency, amount, available, 'base');
        }

        throw new PaymentNetworkErrorClass(
          `Failed to create payment authorization: ${error.error || response.statusText}`
        );
      }

      const authorization = await response.json();
      this.logger.info(`Created EIP-3009 payment authorization`);

      return authorization;
    } catch (error) {
      if (error instanceof InsufficientFundsErrorClass || error instanceof PaymentNetworkErrorClass) {
        throw error;
      }

      // Wrap other errors in PaymentNetworkError
      throw new PaymentNetworkErrorClass(
        `Failed to create payment authorization: ${(error as Error).message}`,
        error as Error
      );
    }
  }
}