import { PaymentServer, ChargeResponse, Charge } from "./types.js";
import { Network, Currency, AuthorizationServerUrl, FetchLike, Logger, PaymentRequestData } from "@atxp/common";
import BigNumber from "bignumber.js";

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
    private readonly fetchFn: FetchLike = fetch) {
  }

  charge = async({source, destination, network, currency, amount}: 
    {source: string, destination: string, network: Network, currency: Currency, amount: BigNumber}): Promise<ChargeResponse> => {
    const body = {source, destination, network, currency, amount};
    const chargeResponse = await this.makeRequest('POST', '/charge', body);
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