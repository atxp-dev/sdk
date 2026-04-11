import { RequirePaymentConfig, extractNetworkFromAccountId, extractAddressFromAccountId, Network, AuthorizationServerUrl } from "@atxp/common";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { BigNumber } from "bignumber.js";
import { getATXPConfig, atxpAccountId, atxpToken, getDetectedCredential, setPendingPaymentChallenge } from "./atxpContext.js";
import { buildPaymentOptions, omniChallengeMcpError } from "./omniChallenge.js";
import { getATXPResource } from "./atxpContext.js";
import { ProtocolSettlement, type SettlementContext } from "./protocol.js";
import { signOpaqueIdentity } from "./opaqueIdentity.js";

export async function requirePayment(paymentConfig: RequirePaymentConfig): Promise<void> {
  const config = getATXPConfig();
  if (!config) {
    throw new Error('No config found');
  }
  const user = atxpAccountId();
  if (!user) {
    config.logger.error('No user found');
    throw new Error('No user found');
  }

  // Use the maximum of minimumPayment and requested price
  const paymentAmount = config.minimumPayment && config.minimumPayment.isGreaterThan(paymentConfig.price)
    ? config.minimumPayment
    : paymentConfig.price;

  // Get network and address from destination Account
  const destinationAccountId = await config.destination.getAccountId();
  const destinationNetwork = extractNetworkFromAccountId(destinationAccountId);
  const destinationAddress = extractAddressFromAccountId(destinationAccountId);

  // Get the user's token for on-demand charging (connection_token flow)
  const token = atxpToken();

  // Always use multi-option format
  const charge = {
    options: [{
      network: destinationNetwork,
      currency: config.currency,
      address: destinationAddress,
      amount: paymentConfig.price
    }],
    sourceAccountId: user,
    destinationAccountId: destinationAccountId,
    payeeName: config.payeeName,
    ...(token && { sourceAccountToken: token }),
  };

  // If a payment credential was detected on this request (retry after challenge),
  // settle it now. We have the full pricing context to generate requirements.
  const detectedCredential = getDetectedCredential();
  if (detectedCredential) {
    await settleDetectedCredential(config, detectedCredential, charge, destinationAccountId, paymentAmount);
    // After settlement, the ledger should be credited. Fall through to charge below.
  }

  config.logger.debug(`Charging ${paymentConfig.price} to ${charge.options.length} options for source ${user}`);

  const chargeSucceeded = await config.paymentServer.charge(charge);
  if (chargeSucceeded) {
    config.logger.info(`Charged ${paymentConfig.price} for source ${user}`);
    return;
  }

  // Check for an existing payment ID first (idempotency) — avoids the
  // getSources fetch when we already have a payment to re-challenge with.
  const existingPaymentId = await paymentConfig.getExistingPaymentId?.();
  if (existingPaymentId) {
    config.logger.info(`Found existing payment ID ${existingPaymentId}`);
    const sources = await fetchAllSources(config, destinationNetwork, destinationAddress);
    throw buildOmniError(config, existingPaymentId, paymentAmount, sources);
  }

  // Fetch all destination chain addresses for the omni-challenge.
  // The primary ATXP destination is always included; chain-specific
  // addresses (base, solana, etc.) come from getSources().
  const allSources = await fetchAllSources(config, destinationNetwork, destinationAddress);

  const options = allSources.map(source => ({
    network: source.chain as Network,
    currency: config.currency,
    address: source.address,
    amount: paymentAmount
  }));

  const paymentRequest = {
    options,
    sourceAccountId: user,
    destinationAccountId: destinationAccountId,
    payeeName: config.payeeName,
  };

  config.logger.debug(`Creating payment request with sourceAccountId: ${user}, destinationAccountId: ${charge.destinationAccountId}`);
  const paymentId = await config.paymentServer.createPaymentRequest(paymentRequest);
  config.logger.info(`Created payment request ${paymentId}`);
  throw buildOmniError(config, paymentId, paymentAmount, allSources);
}

/**
 * Fetch all destination chain addresses for an omni-challenge.
 * Combines the primary ATXP destination with chain-specific addresses from getSources().
 */
async function fetchAllSources(
  config: NonNullable<ReturnType<typeof getATXPConfig>>,
  destinationNetwork: Network,
  destinationAddress: string,
): Promise<Array<{ chain: string; address: string }>> {
  const sources: Array<{ chain: string; address: string }> = [
    { chain: destinationNetwork, address: destinationAddress },
  ];
  try {
    // Request all supported chains including Tempo for MPP challenges.
    // Old SDK clients (< 0.11.0) won't see Tempo because they don't pass
    // ?include=tempo — only the server-side requirePayment does.
    const fetched = await config.destination.getSources({ include: ['tempo'] });
    config.logger.debug(`Fetched ${fetched.length} sources for destination account`);
    sources.push(...fetched);
    config.logger.debug(`Payment request will include ${sources.length} total options`);
  } catch (error) {
    config.logger.warn(`Failed to fetch account sources, will use ATXP option only: ${error}`);
  }
  return sources;
}

/**
 * Settle a payment credential that was detected on this retry request.
 *
 * This runs inside requirePayment because it has the pricing context needed
 * to generate protocol-specific settlement data:
 * - X402: regenerates paymentRequirements from charge options (same as the challenge)
 * - ATXP: passes sourceAccountToken and payment options
 * - MPP: passes credential directly (self-contained)
 *
 * After settlement, the auth service credits the local ledger, so the
 * subsequent charge() call will succeed.
 */
async function settleDetectedCredential(
  config: NonNullable<ReturnType<typeof getATXPConfig>>,
  detected: NonNullable<ReturnType<typeof getDetectedCredential>>,
  charge: { options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>; sourceAccountId: string; destinationAccountId: string },
  destinationAccountId: string,
  paymentAmount: BigNumber,
): Promise<void> {
  const { protocol, credential, sourceAccountId } = detected;
  config.logger.info(`Settling ${protocol} credential in requirePayment (has pricing context)`);

  // ProtocolSettlement is instantiated per-request. This is intentional — the class
  // is lightweight (stores config references only, no connections or heavy init).
  // Caching would require threading persistent state through requirePayment's
  // stateless call chain, for negligible benefit.
  const settlement = new ProtocolSettlement(
    config.server,
    config.logger,
    fetch.bind(globalThis),
    destinationAccountId,
  );

  // Build settlement context with identity and protocol-specific data
  const context: SettlementContext = {
    ...(sourceAccountId && { sourceAccountId }),
    destinationAccountId,
    options: charge.options,
  };

  // For X402, regenerate the paymentRequirements from the destination's
  // real chain addresses (not the ATXP account ID). This is the standard X402
  // pattern — the server generates requirements from its own config.
  if (protocol === 'x402') {
    const resource = getATXPResource()?.toString() ?? '';
    let sources: Array<{ chain: string; address: string }> = charge.options.map(o => ({ chain: o.network, address: o.address }));
    try {
      const fetchedSources = await config.destination.getSources();
      sources = fetchedSources.map(s => ({ chain: s.chain, address: s.address }));
    } catch (err) {
      config.logger.warn(`Failed to fetch destination sources for X402 settle: ${err}`);
    }
    const payment = buildPaymentOptions({ amount: paymentAmount, sources, resource, payeeName: config.payeeName });
    if (payment.x402.accepts.length === 0) {
      config.logger.warn('X402 settle: no compatible payment options after filtering');
    }
    context.paymentRequirements = payment.x402;
  }

  try {
    const result = await settlement.settle(protocol, credential, context);
    config.logger.info(`${protocol} settlement succeeded: txHash=${result.txHash}, amount=${result.settledAmount}`);
  } catch (error) {
    // Settlement failed — the credential was invalid or the on-chain tx failed.
    // Throw an explicit error so the client knows its credential was rejected,
    // rather than silently falling through to charge (which would fail with a
    // confusing insufficient_balance + new challenge).
    const reason = error instanceof Error ? error.message : String(error);
    config.logger.error(`${protocol} settlement failed: ${reason}`);
    throw new McpError(-32000, `Payment settlement failed for ${protocol}`, { protocol, reason });
  }
}

/**
 * Build an omni-challenge MCP error that includes ATXP-MCP + X402 + MPP data.
 * Uses buildPaymentOptions (shared with buildAuthorizeParamsFromSources) to
 * ensure consistent challenge generation across MCP servers and LLM callers.
 */
function buildOmniError(
  config: { server: AuthorizationServerUrl; logger: import("@atxp/common").Logger },
  paymentId: string,
  paymentAmount: BigNumber,
  sources: Array<{ chain: string; address: string }>,
) {
  const resource = getATXPResource()?.toString() ?? '';

  const payment = buildPaymentOptions({
    amount: paymentAmount,
    sources,
    resource,
    payeeName: '',
    challengeId: paymentId,
  });

  if (payment.x402.accepts.length === 0 && sources.length > 0) {
    config.logger.warn(`buildPaymentOptions filtered all ${sources.length} sources — no X402-compatible networks. X402 clients will not see any payment options.`);
  }

  // Inject signed identity into MPP challenges' opaque field.
  // On the retry request, Authorization: Payment replaces Authorization: Bearer,
  // so the server recovers the user identity from this opaque field instead.
  const userId = atxpAccountId();
  if (payment.mpp && userId) {
    for (const challenge of payment.mpp) {
      challenge.opaque = signOpaqueIdentity(userId, challenge.id);
    }
  }

  const error = omniChallengeMcpError(
    config.server,
    paymentId,
    paymentAmount,
    payment.x402,
    payment.mpp,
  );

  // Store in ALS so atxpExpress can rewrite McpServer's wrapped tool error
  // back into a JSON-RPC error with full challenge data. Done here at the
  // throw site (not in omniChallengeMcpError) so the side effect only occurs
  // when the error is actually thrown.
  setPendingPaymentChallenge({
    code: error.code,
    message: error.message,
    data: error.data as Record<string, unknown>,
  });

  return error;
}
