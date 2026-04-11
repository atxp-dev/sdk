import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { PAYMENT_REQUIRED_PREAMBLE, PAYMENT_REQUIRED_ERROR_CODE, AuthorizationServerUrl, USDC_ADDRESSES, CAIP2_NETWORKS } from "@atxp/common";
import { MPP_ERROR_CODE } from "@atxp/mpp";
import { BigNumber } from "bignumber.js";
import type { OmniChallenge, X402PaymentRequirements, AtxpMcpChallengeData, MppChallengeData, X402PaymentOption } from "./protocol.js";

// USDC and pathUSD both use 6 decimals.
const STABLECOIN_DECIMALS = 6;

// X402-compatible network sets
const X402_EVM_NETWORKS = new Set(['base', 'base_sepolia']);
const X402_SVM_NETWORKS = new Set(['solana', 'solana_devnet']);

// CDP facilitator fee payer addresses for Solana X402.
// Source: https://docs.cdp.coinbase.com/x402/network-support
const SOLANA_FEE_PAYERS: Record<string, string> = {
  solana: 'BFK9TLC3edb13K6v4YyH3DwPb5DSUpkWvb7XnqCL9b4F',
  solana_devnet: 'Hc3sdEAsCGQcpgfivywog9uwtk8gUBUZgsxdME1EJy88',
};

/**
 * Build X402 payment requirements from charge options.
 * Returns EVM (Base) and SVM (Solana) options. The accepts array is ordered
 * EVM-first — clients that don't have a chain preference use the first option.
 */
export function buildX402Requirements(args: {
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
  resource: string;
  payeeName: string;
}): X402PaymentRequirements {
  const evmOptions = args.options.filter(o =>
    X402_EVM_NETWORKS.has(o.network) && o.address.startsWith('0x')
  );
  const svmOptions = args.options.filter(o =>
    X402_SVM_NETWORKS.has(o.network) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.address)
  );

  const accepts: X402PaymentOption[] = [
    ...evmOptions.map(option => ({
      scheme: 'exact' as const,
      network: CAIP2_NETWORKS[option.network] || option.network,
      amount: option.amount.times(1e6).toFixed(0),
      resource: args.resource,
      description: args.payeeName,
      mimeType: 'application/json',
      payTo: option.address,
      maxTimeoutSeconds: 300,
      asset: USDC_ADDRESSES[option.network] || USDC_ADDRESSES['base'],
      extra: { name: 'USD Coin', version: '2' },
    })),
    ...svmOptions.map(option => ({
      scheme: 'exact' as const,
      network: CAIP2_NETWORKS[option.network] || option.network,
      amount: option.amount.times(1e6).toFixed(0),
      resource: args.resource,
      description: args.payeeName,
      mimeType: 'application/json',
      payTo: option.address,
      maxTimeoutSeconds: 300,
      asset: USDC_ADDRESSES[option.network] || USDC_ADDRESSES['solana'],
      extra: { feePayer: SOLANA_FEE_PAYERS[option.network] || SOLANA_FEE_PAYERS['solana'] },
    })),
  ];

  return {
    x402Version: 2,
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
 * Returns one challenge per supported chain (Solana and/or Tempo).
 * Returns null if no suitable option is available.
 *
 * MPP spec supports multiple payment methods per 402 response:
 * - HTTP: multiple `WWW-Authenticate: Payment` headers
 * - MCP: array of challenges in `data.mpp`
 */
export function buildMppChallenges(args: {
  id: string;
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
}): MppChallengeData[] | null {
  const challenges: MppChallengeData[] = [];

  // Solana option (USDC on Solana mainnet or devnet)
  // Amount in micro-units (e.g., 10000 = 0.01 USDC). @solana/mpp expects this.
  const solanaOption = args.options.find(o => o.network === 'solana' || o.network === 'solana_devnet');
  if (solanaOption) {
    const isDevnet = solanaOption.network === 'solana_devnet';
    challenges.push({
      id: args.id,
      method: 'solana',
      intent: 'charge',
      amount: solanaOption.amount.times(10 ** STABLECOIN_DECIMALS).toFixed(0),
      currency: USDC_ADDRESSES[isDevnet ? 'solana_devnet' : 'solana'],
      network: isDevnet ? 'devnet' : 'mainnet-beta',
      recipient: solanaOption.address,
    });
  }

  // Tempo option (USDC on Tempo mainnet, pathUSD on moderato)
  // Amount in human-readable format (e.g., "0.01"). mppx's verify schema
  // internally calls parseUnits(amount, decimals) to convert to raw units.
  // This differs from Solana MPP which expects pre-converted micro-units.
  // expires is required by mppx's verify() for Tempo challenge validation.
  const tempoOption = args.options.find(o => o.network === 'tempo' || o.network === 'tempo_moderato');
  if (tempoOption) {
    challenges.push({
      id: args.id,
      method: 'tempo',
      intent: 'charge',
      amount: tempoOption.amount.toString(),
      currency: tempoOption.currency || 'USDC',
      network: tempoOption.network,
      recipient: tempoOption.address,
      expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  }

  return challenges.length > 0 ? challenges : null;
}

/**
 * Build a single MPP challenge (backwards compat helper).
 * @deprecated Use buildMppChallenges for multi-chain support.
 */
export function buildMppChallenge(args: {
  id: string;
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
}): MppChallengeData | null {
  const challenges = buildMppChallenges(args);
  return challenges?.[0] ?? null;
}

/**
 * Serialize MPP challenge data into a WWW-Authenticate: Payment header value.
 * Values are escaped to prevent header injection via double-quote characters.
 */
export function serializeMppHeader(challenge: MppChallengeData): string {
  const esc = (v: string) => v.replace(/"/g, '\\"');
  const base = `Payment method="${esc(challenge.method)}", intent="${esc(challenge.intent)}", id="${esc(challenge.id)}", amount="${esc(challenge.amount)}", currency="${esc(challenge.currency)}", network="${esc(challenge.network)}", recipient="${esc(challenge.recipient)}"`;
  // Append optional fields when present
  const expires = challenge.expires ? `, expires="${esc(challenge.expires)}"` : '';
  return base + expires;
}

/**
 * Create an omni-challenge MCP error containing challenge data for ALL protocols.
 *
 * Uses the legacy ATXP error code (-30402) for backwards compatibility with
 * existing clients that only check for -30402. The MPP spec defines -32042
 * (MPP_ERROR_CODE) but we can't use it yet — old SDK clients (<0.11.0) don't
 * recognize -32042 and would silently ignore payment challenges.
 *
 * New SDK clients (>=0.10.x) accept both -30402 and -32042, so this works
 * with both old and new clients. Once old clients are phased out, switch
 * back to MPP_ERROR_CODE (-32042).
 *
 * error.data contains both ATXP-MCP fields (paymentRequestId, paymentRequestUrl)
 * and MPP fields (data.mpp). Standard MPP clients detect the code + data.mpp.
 * ATXP clients detect the code + data.paymentRequestId.
 * X402 data is included as data.x402 for completeness but X402 is HTTP-only.
 */
export function omniChallengeMcpError(
  server: AuthorizationServerUrl,
  paymentRequestId: string,
  chargeAmount: BigNumber | undefined,
  x402Requirements: X402PaymentRequirements,
  mppChallenges?: MppChallengeData[] | MppChallengeData | null,
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

  // MPP fields (JSON-RPC error code -32042 with mpp array)
  // Normalize single challenge to array for consistency.
  if (mppChallenges) {
    const challenges = Array.isArray(mppChallenges) ? mppChallenges : [mppChallenges];
    if (challenges.length > 0) {
      data.mpp = challenges;
    }
  }

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
 *
 * For multiple MPP challenges, emits multiple WWW-Authenticate headers
 * (comma-separated per RFC 7235 §4.1).
 */
export function omniChallengeHttpResponse(
  server: AuthorizationServerUrl,
  paymentRequestId: string,
  chargeAmount: BigNumber | undefined,
  x402Requirements: X402PaymentRequirements,
  mppChallenges?: MppChallengeData[] | MppChallengeData | null,
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

  if (mppChallenges) {
    const challenges = Array.isArray(mppChallenges) ? mppChallenges : [mppChallenges];
    if (challenges.length > 0) {
      // Multiple WWW-Authenticate values are comma-separated per RFC 7235 §4.1
      headers['WWW-Authenticate'] = challenges.map(c => serializeMppHeader(c)).join(', ');
    }
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
    ? buildMppChallenges({ id: args.mppChallengeId, options: args.options })
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

/**
 * Convert destination sources (from /account/:id/sources) to the internal
 * options format used by buildX402Requirements and buildMppChallenges.
 */
export function sourcesToOptions(
  sources: Array<{ chain: string; address: string }>,
  amount: BigNumber,
  currency = 'USDC',
): Array<{ network: string; currency: string; address: string; amount: BigNumber }> {
  return sources.map(s => ({
    network: s.chain,
    currency,
    address: s.address,
    amount,
  }));
}

/**
 * Build protocol-specific payment data from destination sources.
 *
 * This is the single source of truth for "given chain addresses + amount,
 * what do the protocol challenges look like?" Used by:
 * - requirePayment() → builds omni-challenge MCP error / HTTP 402
 * - LLM / any server-side caller → builds authorize params
 */
export function buildPaymentOptions(args: {
  amount: BigNumber;
  sources: Array<{ chain: string; address: string }>;
  resource?: string;
  payeeName?: string;
  /** Challenge ID for MPP (auto-generated if not provided) */
  challengeId?: string;
}): {
  x402: X402PaymentRequirements;
  mpp: MppChallengeData[] | null;
  /** Internal options format (for callers that need it) */
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
} {
  const options = sourcesToOptions(args.sources, args.amount);
  const challengeId = args.challengeId ?? `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    x402: buildX402Requirements({
      options,
      resource: args.resource ?? '',
      payeeName: args.payeeName ?? '',
    }),
    mpp: buildMppChallenges({ id: challengeId, options }),
    options,
  };
}

/**
 * Build authorize params from destination sources.
 *
 * Returns the protocol-specific fields that should be spread into
 * account.authorize() — X402 paymentRequirements + MPP challenges.
 * The caller provides these alongside { protocols, amount, destination, memo }.
 *
 * This is the server-side equivalent of what the SDK client's
 * ATXPAccountHandler extracts from an MCP omni-challenge. Use it when
 * the caller acts as its own server (e.g., LLM batch settlement).
 */
export function buildAuthorizeParamsFromSources(args: {
  amount: BigNumber;
  sources: Array<{ chain: string; address: string }>;
  resource?: string;
  payeeName?: string;
  challengeId?: string;
}): {
  /** X402: full accepts array — accounts picks chain via ff:x402-chain flag. */
  paymentRequirements?: X402PaymentRequirements;
  /** MPP challenges array (for /authorize/mpp) */
  challenges: MppChallengeData[];
} {
  const payment = buildPaymentOptions(args);
  const hasX402 = payment.x402.accepts.length > 0;
  return {
    ...(hasX402 && { paymentRequirements: payment.x402 }),
    challenges: payment.mpp ?? [],
  };
}
