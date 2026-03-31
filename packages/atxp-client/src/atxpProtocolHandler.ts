import {
  type AuthorizationServerUrl,
} from '@atxp/common';
import type { ProtocolHandler, ProtocolConfig } from './protocolHandler.js';
import {
  isSSEResponse,
  parseMcpMessages,
  parsePaymentRequests,
} from '@atxp/common';

/**
 * Protocol handler for ATXP-MCP payment challenges.
 *
 * Detects JSON-RPC errors with code -30402 (PAYMENT_REQUIRED_ERROR_CODE) in
 * MCP responses (both SSE and JSON formats).
 */
export class ATXPProtocolHandler implements ProtocolHandler {
  readonly protocol = 'atxp';

  async canHandle(response: Response): Promise<boolean> {
    // ATXP-MCP challenges are embedded in MCP JSON-RPC responses,
    // not at the HTTP level. We detect them by looking for error code -30402.
    try {
      const cloned = response.clone();
      const body = await cloned.text();
      if (body.length === 0) return false;

      const paymentRequests = await this.extractPaymentRequests(body);
      return paymentRequests.length > 0;
    } catch {
      return false;
    }
  }

  async handlePaymentChallenge(
    response: Response,
    _originalRequest: { url: string | URL; init?: RequestInit },
    config: ProtocolConfig
  ): Promise<Response | null> {
    const { logger } = config;

    try {
      const body = await response.clone().text();
      const paymentRequests = await this.extractPaymentRequests(body);

      if (paymentRequests.length === 0) {
        return null;
      }

      // ATXP-MCP payment challenges are handled through the fetcher's
      // checkForATXPResponse → handlePaymentRequestError flow, not at
      // the HTTP protocol handler level. Return null so the fetcher's
      // existing MCP payment flow picks it up.
      // This handler's role in the strategy pattern is detection via
      // canHandle() for protocol selection (e.g., protocolFlag), not
      // direct payment handling.
      if (paymentRequests.length > 1) {
        logger.warn(
          `ATXP: multiple payment requirements found in MCP response. ` +
          `The client does not support multiple payment requirements. ` +
          `${paymentRequests.map(pr => pr.url).join(', ')}`
        );
      } else {
        logger.info(`ATXP: payment requirement found in MCP response - ${paymentRequests[0].url}`);
      }

      return null;
    } catch (error) {
      logger.error(`ATXP: error checking for payment requirements: ${error}`);
      return null;
    }
  }

  private async extractPaymentRequests(body: string): Promise<Array<{ url: AuthorizationServerUrl; id: string }>> {
    try {
      if (isSSEResponse(body)) {
        const messages = await parseMcpMessages(body);
        return messages.flatMap(message => parsePaymentRequests(message)).filter(
          (pr): pr is { url: AuthorizationServerUrl; id: string } => pr !== null
        );
      } else {
        const json = JSON.parse(body);
        const messages = await parseMcpMessages(json);
        return messages.flatMap(message => parsePaymentRequests(message)).filter(
          (pr): pr is { url: AuthorizationServerUrl; id: string } => pr !== null
        );
      }
    } catch {
      return [];
    }
  }
}
