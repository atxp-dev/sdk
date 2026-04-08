import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { PAYMENT_REQUIRED_PREAMBLE, AuthorizationServerUrl, USDC_ADDRESSES, CAIP2_NETWORKS } from "@atxp/common";
import { MPP_ERROR_CODE } from "@atxp/mpp";
import { BigNumber } from "bignumber.js";
import type { OmniChallenge, X402PaymentRequirements, AtxpMcpChallengeData, MppChallengeData, X402PaymentOption } from "./protocol.js";

// USDC and pathUSD both use 6 decimals.
const STABLECOIN_DECIMALS = 6;

// Solana USDC mint addresses
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/**
 * Build X402 payment requirements from charge options.
 */
export function buildX402Requirements(args: {
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
  resource: string;
  payeeName: string;
}): X402PaymentRequirements {
  // Filter to X402-compatible options only: real chain addresses on networks with
  // EIP-3009 (transferWithAuthorization) support via the Coinbase CDP facilitator.
  const X402_NETWORKS = new Set(['base', 'base_sepolia']);
  const chainOptions = args.options.filter(o =>
    X402_NETWORKS.has(o.network) && o.address.startsWith('0x')
  );

  const accepts: X402PaymentOption[] = chainOptions.map(option => ({
    scheme: 'exact',
    network: CAIP2_NETWORKS[option.network] || option.network,
    amount: option.amount.times(1e6).toFixed(0),
    resource: args.resource,
    description: args.payeeName,
    mimeType: 'application/json',
    payTo: option.address,
    maxTimeoutSeconds: 300,
    asset: USDC_ADDRESSES[option.network] || USDC_ADDRESSES['base'],
    // EIP-712 domain for Circle's USDC v2 contract (EIP-3009 transferWithAuthorization).
    // If Circle changes the domain name/version in a future contract upgrade, this must be updated.
    extra: { name: 'USD Coin', version: '2' },
  }));

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
  const solanaOption = args.options.find(o => o.network === 'solana' || o.network === 'solana_devnet');
  if (solanaOption) {
    const isDevnet = solanaOption.network === 'solana_devnet';
    challenges.push({
      id: args.id,
      method: 'solana',
      intent: 'charge',
      amount: solanaOption.amount.times(10 ** STABLECOIN_DECIMALS).toFixed(0),
      currency: isDevnet ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT,
      network: isDevnet ? 'devnet' : 'mainnet-beta',
      recipient: solanaOption.address,
    });
  }

  // Tempo option (pathUSD on Tempo mainnet or moderato)
  const tempoOption = args.options.find(o => o.network === 'tempo' || o.network === 'tempo_moderato');
  if (tempoOption) {
    challenges.push({
      id: args.id,
      method: 'tempo',
      intent: 'charge',
      amount: tempoOption.amount.times(10 ** STABLECOIN_DECIMALS).toFixed(0),
      currency: tempoOption.currency || 'pathUSD',
      network: tempoOption.network,
      recipient: tempoOption.address,
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
  /** X402: single payment requirement (first Base option). Matches what
   *  ATXPAccountHandler extracts from the omni-challenge accepts array. */
  paymentRequirements?: X402PaymentOption;
  /** MPP challenges array (for /authorize/mpp) */
  challenges: MppChallengeData[];
} {
  const payment = buildPaymentOptions(args);
  // Extract the first X402 accept — /authorize/x402 expects a single
  // requirement object, not the full { x402Version, accepts } wrapper.
  const firstX402 = payment.x402.accepts[0] ?? undefined;
  return {
    ...(firstX402 && { paymentRequirements: firstX402 }),
    challenges: payment.mpp ?? [],
  };
}
