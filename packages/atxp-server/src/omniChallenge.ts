import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { PAYMENT_REQUIRED_PREAMBLE, AuthorizationServerUrl } from "@atxp/common";
import { MPP_ERROR_CODE } from "@atxp/mpp";
import { BigNumber } from "bignumber.js";
import type { OmniChallenge, X402PaymentRequirements, AtxpMcpChallengeData, MppChallengeData, X402PaymentOption } from "./protocol.js";

// pathUSD uses 6 decimals, same as USDC. If a new Tempo stablecoin uses
// different decimals, this constant and buildMppChallenge need updating.
const PATHUSD_DECIMALS = 6;

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
    // X402 spec normalizes testnet networks to their mainnet names in challenges.
    // base_sepolia → base so the client knows which chain family to use.
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
 * Build MPP challenge data from charge options.
 * Uses the first Tempo-compatible option (MPP requires Tempo chain).
 * Returns null if no suitable option is available.
 */
export function buildMppChallenge(args: {
  id: string;
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
}): MppChallengeData | null {
  const tempoOption = args.options.find(o => o.network === 'tempo' || o.network === 'tempo_moderato');
  if (!tempoOption) return null;

  return {
    id: args.id,
    method: 'tempo',
    intent: 'charge',
    amount: tempoOption.amount.times(10 ** PATHUSD_DECIMALS).toFixed(0),
    currency: tempoOption.currency || 'pathUSD',
    network: tempoOption.network,
    recipient: tempoOption.address,
  };
}

/**
 * Serialize MPP challenge data into a WWW-Authenticate: Payment header value.
 * Values are escaped to prevent header injection via double-quote characters.
 */
export function serializeMppHeader(challenge: MppChallengeData): string {
  const esc = (v: string) => v.replace(/"/g, '\\"');
  return `Payment method="${esc(challenge.method)}", intent="${esc(challenge.intent)}", id="${esc(challenge.id)}", amount="${esc(challenge.amount)}", currency="${esc(challenge.currency)}", network="${esc(challenge.network)}", recipient="${esc(challenge.recipient)}"`;
}

/**
 * Create an omni-challenge MCP error containing challenge data for ALL protocols.
 *
 * Uses MPP's error code (-32042) as the unified payment-required code.
 * error.data contains both ATXP-MCP fields (paymentRequestId, paymentRequestUrl)
 * and MPP fields (data.mpp). Standard MPP clients detect -32042 + data.mpp.
 * ATXP clients detect -32042 + data.paymentRequestId (and also handle legacy -30402).
 * X402 data is included as data.x402 for completeness but X402 is HTTP-only.
 */
export function omniChallengeMcpError(
  server: AuthorizationServerUrl,
  paymentRequestId: string,
  chargeAmount: BigNumber | undefined,
  x402Requirements: X402PaymentRequirements,
  mppChallenge?: MppChallengeData | null,
): McpError {
  const atxpMcp = buildAtxpMcpChallenge(server, paymentRequestId, chargeAmount);

  const data: Record<string, unknown> = {
    // ATXP-MCP fields (existing, preserved for backwards compatibility)
    paymentRequestId: atxpMcp.paymentRequestId,
    paymentRequestUrl: atxpMcp.paymentRequestUrl,
    chargeAmount: atxpMcp.chargeAmount,
    // X402 fields
    x402: x402Requirements,
  };

  // MPP fields (JSON-RPC error code -32042 with mpp object)
  if (mppChallenge) {
    data.mpp = mppChallenge;
  }

  const amountText = chargeAmount ? ` You will be charged ${chargeAmount.toString()}.` : '';
  return new McpError(
    MPP_ERROR_CODE,
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
  mppChallenge?: MppChallengeData | null,
): {
  status: 402;
  headers: Record<string, string>;
  body: string;
} {
  const atxpMcp = buildAtxpMcpChallenge(server, paymentRequestId, chargeAmount);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ATXP-Payment-Request': JSON.stringify(atxpMcp),
  };

  if (mppChallenge) {
    headers['WWW-Authenticate'] = serializeMppHeader(mppChallenge);
  }

  return {
    status: 402,
    headers,
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
  /** Unique challenge ID for MPP (e.g. payment request ID) */
  mppChallengeId?: string;
}): OmniChallenge {
  const mpp = args.mppChallengeId
    ? buildMppChallenge({ id: args.mppChallengeId, options: args.options })
    : null;

  return {
    atxpMcp: buildAtxpMcpChallenge(args.server, args.paymentRequestId, args.chargeAmount),
    x402: buildX402Requirements({
      options: args.options,
      resource: args.resource,
      payeeName: args.payeeName,
    }),
    ...(mpp && { mpp }),
  };
}
