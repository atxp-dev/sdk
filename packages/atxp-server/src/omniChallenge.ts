import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { PAYMENT_REQUIRED_PREAMBLE, PAYMENT_REQUIRED_ERROR_CODE, AuthorizationServerUrl, USDC_ADDRESSES, CAIP2_NETWORKS, FetchLike } from "@atxp/common";
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
 * Map of CAIP-2 network → upto facilitator address, cached per auth server URL with
 * a bounded TTL. The promise (not the value) is cached so concurrent first callers
 * share one fetch; an empty/failed result is not cached so a later call can retry.
 * The TTL bounds staleness if the facilitator's settle address rotates while a
 * long-lived resource-server process is up (a stale witness would revert settles).
 */
const _FACILITATOR_ADDRESS_TTL_MS = 10 * 60 * 1000;
const _facilitatorAddressCache = new Map<string, { at: number; value: Promise<Record<string, string>> }>();

/**
 * Fetch the upto facilitator addresses from the auth server's GET /x402/supported
 * endpoint. The response is a flat CAIP-2 network → address map. Cached per auth
 * server URL for up to TTL. On failure, returns {} (so the upto accept is simply
 * omitted) and does not cache, allowing a later retry.
 */
export async function fetchUptoFacilitatorAddresses(
  authServerUrl: AuthorizationServerUrl | string,
  fetchFn: FetchLike = fetch.bind(globalThis),
  logger?: { warn: (msg: string) => void },
): Promise<Record<string, string>> {
  const url = new URL('/x402/supported', authServerUrl).toString();
  const cached = _facilitatorAddressCache.get(url);
  if (cached && Date.now() - cached.at < _FACILITATOR_ADDRESS_TTL_MS) return cached.value;

  const pending = (async () => {
    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        logger?.warn(`fetchUptoFacilitatorAddresses: ${url} returned ${response.status}; advertising exact only`);
        return {};
      }
      const body = await response.json() as Record<string, string>;
      return (body && typeof body === 'object') ? body : {};
    } catch (error) {
      logger?.warn(`fetchUptoFacilitatorAddresses: failed to fetch ${url}: ${error}; advertising exact only`);
      return {};
    }
  })();

  _facilitatorAddressCache.set(url, { at: Date.now(), value: pending });
  const result = await pending;
  // Don't cache an empty map — let a later call retry once the facilitator is up.
  if (Object.keys(result).length === 0) {
    _facilitatorAddressCache.delete(url);
  }
  return result;
}

/**
 * Tempo MPP session (TIP-1034) parameters advertised by auth's GET /mpp/supported:
 * the channel `authorizedSigner` + `operator` (auth's settler key), the escrow
 * precompile, and the chain id. When present, the SDK advertises a `session`-intent
 * challenge alongside the one-shot `charge` intent so accounts can open a metered
 * channel; when absent, only `charge` is advertised (graceful fallback).
 */
export type MppSessionSupport = {
  escrowContract: string;
  authorizedSigner: string;
  operator: string;
  chainId: number;
};

/** Solana MPP session params from auth's GET /mpp/supported. accounts opens the channel and
 *  uses its own operator/fee-payer, so the SDK only needs auth's Solana authorizedSigner. */
export type SolanaMppSessionSupport = {
  chain: 'solana';
  network: string;
  authorizedSigner: string;
};

/** Combined MPP session support across chains, from GET /mpp/supported. */
export type MppSupported = { tempo: MppSessionSupport | null; solana: SolanaMppSessionSupport | null };

const _mppSupportedCache = new Map<string, { at: number; value: Promise<MppSupported | null> }>();

/**
 * Fetch Tempo MPP session support from the auth server's GET /mpp/supported.
 * Response shape: `{ tempo: { authorizedSigner, operator, escrowContract, chainId } | null }`.
 * Cached per auth server URL with the same TTL/retry semantics as the x402 fetch
 * (the settler address could rotate; an unreachable auth must not be cached).
 */
export async function fetchMppSupported(
  authServerUrl: AuthorizationServerUrl | string,
  fetchFn: FetchLike = fetch.bind(globalThis),
  logger?: { warn: (msg: string) => void },
): Promise<MppSupported | null> {
  const url = new URL('/mpp/supported', authServerUrl).toString();
  const cached = _mppSupportedCache.get(url);
  if (cached && Date.now() - cached.at < _FACILITATOR_ADDRESS_TTL_MS) return cached.value;

  const pending = (async (): Promise<MppSupported | null> => {
    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        logger?.warn(`fetchMppSupported: ${url} returned ${response.status}; advertising charge only`);
        return null;
      }
      const body = await response.json() as { tempo?: MppSessionSupport | null; solana?: SolanaMppSessionSupport | null };
      const tempo = (body?.tempo && body.tempo.authorizedSigner && body.tempo.operator && body.tempo.escrowContract) ? body.tempo : null;
      const solana = (body?.solana && body.solana.authorizedSigner) ? body.solana : null;
      if (!tempo && !solana) return null;
      return { tempo, solana };
    } catch (error) {
      logger?.warn(`fetchMppSupported: failed to fetch ${url}: ${error}; advertising charge only`);
      return null;
    }
  })();

  _mppSupportedCache.set(url, { at: Date.now(), value: pending });
  const result = await pending;
  // Don't cache a null (auth unreachable / not configured) — allow a later retry.
  if (result === null) _mppSupportedCache.delete(url);
  return result;
}

/**
 * Build X402 payment requirements from charge options.
 *
 * Each EVM (Base) network advertises BOTH schemes so any client can pay:
 * - 'exact': transfer the advertised amount (EIP-3009). Always advertised.
 * - 'upto': sign a Permit2 capped at `amount`, meter locally, settle the actual
 *   ≤ cap via settlementOverrides.amount. Only advertised when we have a
 *   facilitatorAddress for that network (the only address allowed to settle the
 *   permit), supplied via `facilitatorAddresses` (from GET /x402/supported).
 *   Without one, the upto accept would be unusable, so it's omitted.
 * SVM (Solana) stays 'exact' only — Solana upto is not implemented yet.
 * See docs/STREAMING_PAYMENT_SESSIONS.md.
 *
 * The accepts array is ordered EVM-first — clients without a chain preference use
 * the first option.
 */
export function buildX402Requirements(args: {
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>;
  resource: string;
  payeeName: string;
  /** CAIP-2 network → upto facilitator address. When absent for a network, only
   *  the exact accept is advertised for it. */
  facilitatorAddresses?: Record<string, string>;
}): X402PaymentRequirements {
  const evmOptions = args.options.filter(o =>
    X402_EVM_NETWORKS.has(o.network) && o.address.startsWith('0x')
  );
  const svmOptions = args.options.filter(o =>
    X402_SVM_NETWORKS.has(o.network) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.address)
  );
  const facilitatorAddresses = args.facilitatorAddresses ?? {};

  const accepts: X402PaymentOption[] = [];

  for (const option of evmOptions) {
    const caip2 = CAIP2_NETWORKS[option.network] || option.network;
    const base = {
      network: caip2,
      amount: option.amount.times(1e6).toFixed(0),
      resource: args.resource,
      description: args.payeeName,
      mimeType: 'application/json',
      payTo: option.address,
      maxTimeoutSeconds: 300,
      asset: USDC_ADDRESSES[option.network] || USDC_ADDRESSES['base'],
    };
    // Always advertise exact (the EIP-712 domain lives in extra, as today).
    accepts.push({ ...base, scheme: 'exact', extra: { name: 'USD Coin', version: '2' } });
    // Advertise upto only when we have a facilitator address to pin in the permit.
    const facilitatorAddress = facilitatorAddresses[caip2];
    if (facilitatorAddress) {
      accepts.push({ ...base, scheme: 'upto', extra: { name: 'USD Coin', version: '2', facilitatorAddress } });
    }
  }

  for (const option of svmOptions) {
    accepts.push({
      scheme: 'exact',
      network: CAIP2_NETWORKS[option.network] || option.network,
      amount: option.amount.times(1e6).toFixed(0),
      resource: args.resource,
      description: args.payeeName,
      mimeType: 'application/json',
      payTo: option.address,
      maxTimeoutSeconds: 300,
      asset: USDC_ADDRESSES[option.network] || USDC_ADDRESSES['solana'],
      extra: { feePayer: SOLANA_FEE_PAYERS[option.network] || SOLANA_FEE_PAYERS['solana'] },
    });
  }

  // Dedupe by scheme + resolved (CAIP-2) network: fetchAllSources can surface the
  // same chain more than once (e.g. the destination's address plus a same-chain
  // entry from getSources, sometimes with a different label/address), which would
  // otherwise advertise duplicate exact/upto accepts. Keep the first per (scheme,
  // network) — that's the destination's primary option for the chain.
  const seenAccept = new Set<string>();
  const dedupedAccepts = accepts.filter(a => {
    const key = `${a.scheme}:${a.network}`;
    if (seenAccept.has(key)) return false;
    seenAccept.add(key);
    return true;
  });

  return {
    x402Version: 2,
    accepts: dedupedAccepts,
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
  resource?: string;
  /** When present, advertise a Tempo `session`-intent challenge alongside `charge`
   *  (TIP-1034 channel sessions). From GET /mpp/supported via fetchMppSupported. */
  mppSession?: MppSessionSupport;
  /** When present, advertise a Solana `session`-intent challenge alongside the Solana charge. */
  mppSolanaSession?: SolanaMppSessionSupport;
  /** Channel deposit budget hint (raw µUSDC) for the session challenge. accounts
   *  may override; a larger-than-cap deposit lets one channel serve many requests. */
  mppSuggestedDeposit?: string;
}): MppChallengeData[] | null {
  const challenges: MppChallengeData[] = [];
  const resourceField = args.resource ? { resource: { url: args.resource } } : {};

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
      ...resourceField,
      request: {
        amount: solanaOption.amount.times(10 ** STABLECOIN_DECIMALS).toFixed(0),
        currency: USDC_ADDRESSES[isDevnet ? 'solana_devnet' : 'solana'],
        recipient: solanaOption.address,
        ...resourceField,
      },
    });

    // Solana `session`-intent challenge (payment-channels program) when auth advertises it.
    // accounts opens the channel + uses its own operator/fee-payer; methodDetails carries
    // only auth's Solana authorizedSigner. Same micro-units amount as the Solana charge.
    if (args.mppSolanaSession) {
      const solCurrency = USDC_ADDRESSES[isDevnet ? 'solana_devnet' : 'solana'];
      const solAmount = solanaOption.amount.times(10 ** STABLECOIN_DECIMALS).toFixed(0);
      challenges.push({
        id: args.id,
        method: 'solana',
        intent: 'session',
        amount: solAmount,
        currency: solCurrency,
        network: isDevnet ? 'devnet' : 'mainnet-beta',
        recipient: solanaOption.address,
        ...resourceField,
        request: {
          amount: solAmount,
          currency: solCurrency,
          recipient: solanaOption.address,
          ...resourceField,
          methodDetails: {
            authorizedSigner: args.mppSolanaSession.authorizedSigner,
            ...(args.mppSuggestedDeposit && { suggestedDeposit: args.mppSuggestedDeposit }),
          },
        },
      });
    }
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
      ...resourceField,
      request: {
        amount: tempoOption.amount.toString(),
        currency: tempoOption.currency || 'USDC',
        recipient: tempoOption.address,
        ...resourceField,
      },
    });

    // Also advertise a `session`-intent challenge (TIP-1034 channel) when auth
    // exposes the settler params. accounts picks charge vs session via
    // ff:mpp-intent; both carry the same per-request `amount` (the cap). The
    // channel params (escrow, authorizedSigner, operator) ride in
    // request.methodDetails so accounts can open/reuse the channel.
    if (args.mppSession) {
      challenges.push({
        id: args.id,
        method: 'tempo',
        intent: 'session',
        amount: tempoOption.amount.toString(),
        currency: tempoOption.currency || 'USDC',
        network: tempoOption.network,
        recipient: tempoOption.address,
        expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        ...resourceField,
        request: {
          amount: tempoOption.amount.toString(),
          currency: tempoOption.currency || 'USDC',
          recipient: tempoOption.address,
          ...resourceField,
          methodDetails: {
            chainId: args.mppSession.chainId,
            escrowContract: args.mppSession.escrowContract,
            authorizedSigner: args.mppSession.authorizedSigner,
            operator: args.mppSession.operator,
            ...(args.mppSuggestedDeposit && { suggestedDeposit: args.mppSuggestedDeposit }),
          },
        },
      });
    }
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
  resource?: string;
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
  /** CAIP-2 network → upto facilitator address (from GET /x402/supported). */
  facilitatorAddresses?: Record<string, string>;
  /** Tempo MPP session support (from GET /mpp/supported). Advertises the session intent. */
  mppSession?: MppSessionSupport;
}): OmniChallenge {
  const mpp = args.mppChallengeId
    ? buildMppChallenges({ id: args.mppChallengeId, options: args.options, resource: args.resource, mppSession: args.mppSession })
    : null;

  return {
    atxpMcp: buildAtxpMcpChallenge(args.server, args.paymentRequestId, args.chargeAmount),
    x402: buildX402Requirements({
      options: args.options,
      resource: args.resource,
      payeeName: args.payeeName,
      facilitatorAddresses: args.facilitatorAddresses,
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
  /** CAIP-2 network → upto facilitator address (from GET /x402/supported).
   *  When absent for a network, only the exact x402 accept is advertised. */
  facilitatorAddresses?: Record<string, string>;
  /** Tempo MPP session support (from GET /mpp/supported). Advertises the session intent. */
  mppSession?: MppSessionSupport;
  /** Solana MPP session support (from GET /mpp/supported). Advertises the Solana session intent. */
  mppSolanaSession?: SolanaMppSessionSupport;
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
      facilitatorAddresses: args.facilitatorAddresses,
    }),
    mpp: buildMppChallenges({ id: challengeId, options, resource: args.resource, mppSession: args.mppSession, mppSolanaSession: args.mppSolanaSession }),
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
  /** CAIP-2 network → upto facilitator address (from GET /x402/supported). */
  facilitatorAddresses?: Record<string, string>;
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
