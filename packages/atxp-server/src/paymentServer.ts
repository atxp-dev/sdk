import { PaymentServer, ChargeResponse } from "./types.js";
import { Network, Currency, AuthorizationServerUrl, FetchLike, Logger, PaymentRequestData } from "@atxp/common";
import BigNumber from "bignumber.js";

/**
 * ATXP Payment Server implementation
 * 
 * This class handles payment operations with the ATXP authorization server.
 * 
 * **Required Environment Variable:**
 * - `ATXP_AUTH_CLIENT_TOKEN`: Authentication token for the ATXP authorization server.
 *   This token is used to authenticate API calls to the ATXP server for payment operations.
 *   Must be set when using this class, otherwise an error will be thrown.
 * 
 * @example
 * ```typescript
 * // Ensure ATXP_AUTH_CLIENT_TOKEN is set in your environment
 * const paymentServer = new ATXPPaymentServer(
 *   'https://auth.atxp.ai',
 *   oAuthDb,
 *   logger
 * );
 * ```
 */
export class ATXPPaymentServer implements PaymentServer {
  constructor(
    private readonly server: AuthorizationServerUrl, 
    private readonly authCredentials: string,
    private readonly logger: Logger,
    private readonly fetchFn: FetchLike = fetch) {
    if (!authCredentials || authCredentials.trim() === '') {
      throw new Error('Auth credentials are required');
    }
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

  createPaymentRequest = async({source, destination, network, currency, amount}: 
    {source: string, destination: string, network: Network, currency: Currency, amount: BigNumber}): Promise<string> => {
    const body = {source, destination, network, currency, amount};
    const response = await this.makeRequest('POST', '/payment-request', body);
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
   * This method automatically includes the `ATXP_AUTH_CLIENT_TOKEN` from environment variables
   * in the Authorization header for all requests.
   * 
   * @param method - HTTP method ('GET' or 'POST')
   * @param path - API endpoint path
   * @param body - Request body (for POST requests)
   * @returns Promise<Response> - The HTTP response from the server
   * @throws {Error} When `ATXP_AUTH_CLIENT_TOKEN` environment variable is not set
   * 
   * @example
   * ```typescript
   * // Ensure ATXP_AUTH_CLIENT_TOKEN is set in your environment
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
        'Authorization': `Bearer ${this.authCredentials}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return response;
  }
}