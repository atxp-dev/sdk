import { PaymentServer, Charge } from "./types.js";
import { AuthorizationServerUrl, FetchLike, Logger, OAuthDb } from "@atxp/common";

/**
 * Expected error response format from ATXP payment server
 */
interface PaymentServerErrorResponse {
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  message?: string;
}

/**
 * ATXP Payment Server implementation
 *
 * This class handles payment operations with the ATXP authorization server.
 *
 * @example
 * ```typescript
 * const paymentServer = new ATXPPaymentServer(
 *   'https://auth.atxp.ai',
 *   logger,
 *   fetch,
 *   oAuthDb  // For looking up client credentials
 * );
 * ```
 */
export class ATXPPaymentServer implements PaymentServer {
  constructor(
    private readonly server: AuthorizationServerUrl,
    private readonly logger: Logger,
    private readonly fetchFn: FetchLike = fetch.bind(globalThis),
    private readonly oAuthDb?: OAuthDb) {
  }

  charge = async(chargeRequest: Charge): Promise<boolean> => {
    const chargeResponse = await this.makeRequest('POST', '/charge', chargeRequest);
    if (chargeResponse.status === 200) {
      return true;
    } else if (chargeResponse.status === 402) {
      return false;
    } else {
      const errorBody = await chargeResponse.json() as PaymentServerErrorResponse;

      // Extract detailed error information from response
      const errorCode = errorBody.error?.code || 'UNKNOWN_ERROR';
      const errorMessage = errorBody.error?.message || errorBody.message || 'Unknown error';
      const errorDetails = errorBody.error?.details;

      this.logger.warn(`Payment server charge failed with ${chargeResponse.status}: ${errorMessage} (code: ${errorCode})`);

      // Create a structured error with detailed information
      const error = new Error(
        `Payment server returned ${chargeResponse.status} from /charge: ${errorMessage}`
      ) as Error & {
        statusCode: number;
        errorCode: string;
        details: unknown;
        endpoint: string;
      };
      // Attach structured data to the error for downstream handling
      error.statusCode = chargeResponse.status;
      error.errorCode = errorCode;
      error.details = errorDetails;
      error.endpoint = '/charge';

      throw error;
    }
  }

  createPaymentRequest = async(charge: Charge): Promise<string> => {
    const response = await this.makeRequest('POST', '/payment-request', charge);
    const json = await response.json() as ({ id?: string } & PaymentServerErrorResponse);

    if (response.status !== 200) {
      // Extract error details from response
      const errorCode = json.error?.code || 'UNKNOWN_ERROR';
      const errorMessage = json.error?.message || json.message || 'Unknown error';
      const errorDetails = json.error?.details;

      this.logger.warn(`POST /payment-request responded with unexpected HTTP status ${response.status}: ${errorMessage} (code: ${errorCode})`);

      // Create structured error with detailed information
      const error = new Error(
        `Payment server returned ${response.status} from /payment-request: ${errorMessage}`
      ) as Error & {
        statusCode: number;
        errorCode: string;
        details: unknown;
        endpoint: string;
      };
      error.statusCode = response.status;
      error.errorCode = errorCode;
      error.details = errorDetails;
      error.endpoint = '/payment-request';

      throw error;
    }

    if (!json.id) {
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add Basic auth header with client credentials if available
    // This authenticates the MCP server to enable resource_url validation
    if (this.oAuthDb) {
      try {
        const credentials = await this.oAuthDb.getClientCredentials(this.server);
        if (credentials?.clientId && credentials?.clientSecret) {
          const credentialString = `${credentials.clientId}:${credentials.clientSecret}`;
          const base64Credentials = Buffer.from(credentialString).toString('base64');
          headers['Authorization'] = `Basic ${base64Credentials}`;
        }
      } catch (error) {
        this.logger.warn('Failed to get client credentials for /charge authentication', error);
      }
    }

    const response = await this.fetchFn(url, {
      method,
      headers,
      body: JSON.stringify(body)
    });
    return response;
  }
}