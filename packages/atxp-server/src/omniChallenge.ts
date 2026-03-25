import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { PAYMENT_REQUIRED_ERROR_CODE, PAYMENT_REQUIRED_PREAMBLE, AuthorizationServerUrl } from "@atxp/common";
import { BigNumber } from "bignumber.js";
import type { OmniChallenge, X402PaymentRequirements, AtxpMcpChallengeData, X402PaymentOption } from "./protocol.js";

/**
 * Build X402 payment requirements from charge options.
 */
export function buildX402Requirements(args: {
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
  resource: string;
  payeeName: string;
}): X402PaymentRequirements {
  const accepts: X402PaymentOption[] = args.options.map(option => ({
    scheme: 'exact',
    network: option.network === 'base' || option.network === 'base_sepolia' ? 'base' : option.network,
    maxAmountRequired: option.amount.times(1e6).toFixed(0), // Convert to smallest unit (USDC has 6 decimals)
    resource: args.resource,
    description: args.payeeName,
    payTo: option.address,
    maxTimeoutSeconds: 300,
  }));

  return {
    x402Version: 1,
    accepts,
  };
}

/**
 * Build ATXP-MCP challenge data from a payment request.
 */
export function buildAtxpMcpChallenge(
  server: AuthorizationServerUrl,
  paymentRequestId: string,
  chargeAmount?: BigNumber,
): AtxpMcpChallengeData {
  const serverUrl = new URL(server);
  const origin = serverUrl.origin as AuthorizationServerUrl;
  const paymentRequestUrl = `${origin}/payment-request/${paymentRequestId}`;

  return {
    paymentRequestId,
    paymentRequestUrl,
    ...(chargeAmount && { chargeAmount: chargeAmount.toString() }),
  };
}

/**
 * Create an omni-challenge MCP error (for MCP SSE transport).
 * Contains both ATXP-MCP challenge data in a single JSON-RPC error.
 */
export function omniChallengeMcpError(
  server: AuthorizationServerUrl,
  paymentRequestId: string,
  chargeAmount: BigNumber | undefined,
  x402Requirements: X402PaymentRequirements,
): McpError {
  const atxpMcp = buildAtxpMcpChallenge(server, paymentRequestId, chargeAmount);

  const data = {
    // ATXP-MCP fields (existing, preserved for backwards compatibility)
    paymentRequestId: atxpMcp.paymentRequestId,
    paymentRequestUrl: atxpMcp.paymentRequestUrl,
    chargeAmount: atxpMcp.chargeAmount,
    // X402 fields (new, added for omni-challenge)
    x402: x402Requirements,
  };

  const amountText = chargeAmount ? ` You will be charged ${chargeAmount.toString()}.` : '';
  return new McpError(
    PAYMENT_REQUIRED_ERROR_CODE,
    `${PAYMENT_REQUIRED_PREAMBLE}${amountText} Please pay at: ${atxpMcp.paymentRequestUrl} and then try again.`,
    data,
  );
}

/**
 * Build an HTTP omni-challenge response for streamable HTTP / plain HTTP.
 *
 * Returns:
 * - status: 402
 * - headers: includes X-ATXP-Payment-Request header with ATXP-MCP data
 * - body: X402 payment requirements JSON
 */
export function omniChallengeHttpResponse(
  server: AuthorizationServerUrl,
  paymentRequestId: string,
  chargeAmount: BigNumber | undefined,
  x402Requirements: X402PaymentRequirements,
): {
  status: 402;
  headers: Record<string, string>;
  body: string;
} {
  const atxpMcp = buildAtxpMcpChallenge(server, paymentRequestId, chargeAmount);

  return {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-ATXP-Payment-Request': JSON.stringify(atxpMcp),
    },
    body: JSON.stringify(x402Requirements),
  };
}

/**
 * Build a complete OmniChallenge object from server config and payment details.
 */
export function buildOmniChallenge(args: {
  server: AuthorizationServerUrl;
  paymentRequestId: string;
  chargeAmount?: BigNumber;
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
  resource: string;
  payeeName: string;
}): OmniChallenge {
  return {
    atxpMcp: buildAtxpMcpChallenge(args.server, args.paymentRequestId, args.chargeAmount),
    x402: buildX402Requirements({
      options: args.options,
      resource: args.resource,
      payeeName: args.payeeName,
    }),
  };
}
