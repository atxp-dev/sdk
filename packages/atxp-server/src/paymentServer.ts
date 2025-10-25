import { PaymentServer, ChargeResponse, Charge } from "./types.js";
import { AuthorizationServerUrl, FetchLike, Logger, PaymentRequestData } from "@atxp/common";

/**
 * ATXP Payment Server implementation
 * 
 * This class handles payment operations with the ATXP authorization server.
 * 
 * @example
 * ```typescript
 * const paymentServer = new ATXPPaymentServer(
 *   'https://auth.atxp.ai',
 *   logger
 * );
 * ```
 */
export class ATXPPaymentServer implements PaymentServer {
  constructor(
    private readonly server: AuthorizationServerUrl,
    private readonly logger: Logger,
    private readonly fetchFn: FetchLike = fetch.bind(globalThis)) {
  }

  charge = async(chargeRequest: Charge): Promise<ChargeResponse> => {
    const chargeResponse = await this.makeRequest('POST', '/charge', chargeRequest);
    const json = await chargeResponse.json() as PaymentRequestData | null;
    if (chargeResponse.status === 200) {
      return {success: true, requiredPayment: null};
    } else if (chargeResponse.status === 402) {
      return {success: false, requiredPayment: json};
    } else {
      const msg = `Unexpected status code ${chargeResponse.status} from payment server POST /charge endpoint`;
      this.logger.warn(msg);
      this.logger.debug(`Response body: ${JSON.stringify(json)}`);
      throw new Error(msg);
    }
  }

  createPaymentRequest = async(charge: Charge): Promise<string> => {
    const response = await this.makeRequest('POST', '/payment-request', charge);
    const json = await response.json() as {id?: string};
    if (response.status !== 200) {
      this.logger.warn(`POST /payment-request responded with unexpected HTTP status ${response.status}`);
      this.logger.debug(`Response body: ${JSON.stringify(json)}`);
      throw new Error(`POST /payment-request responded with unexpected HTTP status ${response.status}`);
    }
    if(!json.id) {
      throw new Error(`POST /payment-request response did not contain an id`);
    }
    return json.id;
  }

  /**
   * Validates a transaction against a payment request
   * This is used to verify that a blockchain transaction satisfies a payment intent
   *
   * @param accountId - The account ID that created the payment request
   * @param paymentRequestId - The payment request ID to validate against
   * @param transaction - The transaction details to validate
   * @returns Promise<boolean> - True if the transaction is valid
   */
  validateTransaction = async(
    accountId: string,
    paymentRequestId: string,
    transaction: {
      transactionHash: string;
      fromAddress: string;
      toAddress: string;
      amount: string;
      network: string;
      tokenAddress?: string;
      blockNumber?: number;
      timestamp?: number;
    }
  ): Promise<{valid: boolean; error?: string; details?: any}> => {
    // Strip network prefix if present
    const unqualifiedId = accountId.includes(':') ? accountId.split(':')[1] : accountId;

    const response = await this.makeRequest(
      'POST',
      `/account/${unqualifiedId}/destination/${paymentRequestId}/validate`,
      transaction
    );

    const json = await response.json() as {
      valid: boolean;
      error?: string;
      message?: string;
      details?: any;
    };

    if (response.status === 200) {
      return {valid: true, details: json.details};
    } else if (response.status === 400) {
      return {valid: false, error: json.error || json.message, details: json.details};
    } else {
      this.logger.warn(`Unexpected status ${response.status} from validation endpoint`);
      this.logger.debug(`Response body: ${JSON.stringify(json)}`);
      throw new Error(`Validation request failed with status ${response.status}`);
    }
  }

  /**
   * Makes authenticated requests to the ATXP authorization server
   * 
   * @param method - HTTP method ('GET' or 'POST')
   * @param path - API endpoint path
   * @param body - Request body (for POST requests)
   * @returns Promise<Response> - The HTTP response from the server
   * 
   * @example
   * ```typescript
   * const response = await paymentServer.makeRequest('POST', '/charge', {
   *   source: 'user123',
   *   destination: 'merchant456',
   *   amount: new BigNumber('0.01')
   * });
   * ```
   */
  protected makeRequest = async(method: 'GET' | 'POST', path: string, body: unknown): Promise<Response> => {
    const url = new URL(path, this.server);
    const response = await this.fetchFn(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return response;
  }
}