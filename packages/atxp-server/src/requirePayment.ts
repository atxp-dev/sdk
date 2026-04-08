import { RequirePaymentConfig, extractNetworkFromAccountId, extractAddressFromAccountId, Network, AuthorizationServerUrl } from "@atxp/common";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { BigNumber } from "bignumber.js";
import { getATXPConfig, atxpAccountId, atxpToken, getDetectedCredential } from "./atxpContext.js";
import { buildPaymentOptions, sourcesToOptions, buildX402Requirements, omniChallengeMcpError } from "./omniChallenge.js";
import { getATXPResource } from "./atxpContext.js";
import { ProtocolSettlement, type SettlementContext } from "./protocol.js";

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

  // Fetch all destination chain addresses for the omni-challenge.
  // The primary ATXP destination is always included; chain-specific
  // addresses (base, solana, etc.) come from getSources().
  const options = [{
    network: destinationNetwork,
    currency: config.currency,
    address: destinationAddress,
    amount: paymentAmount
  }];

  let fetchedSources: Array<{ chain: string; address: string }> = [];
  try {
    fetchedSources = await config.destination.getSources();
    config.logger.debug(`Fetched ${fetchedSources.length} sources for destination account`);
    for (const source of fetchedSources) {
      options.push({
        network: source.chain as Network,
        currency: config.currency,
        address: source.address,
        amount: paymentAmount
      });
    }
    config.logger.debug(`Payment request will include ${options.length} total options`);
  } catch (error) {
    config.logger.warn(`Failed to fetch account sources, will use ATXP option only: ${error}`);
  }

  // Sources for buildOmniError — combines primary + fetched
  const allSources = [
    { chain: destinationNetwork, address: destinationAddress },
    ...fetchedSources,
  ];

  const existingPaymentId = await paymentConfig.getExistingPaymentId?.();
  if (existingPaymentId) {
    config.logger.info(`Found existing payment ID ${existingPaymentId}`);
    throw buildOmniError(config, existingPaymentId, paymentAmount, allSources);
  }

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

  return omniChallengeMcpError(
    config.server,
    paymentId,
    paymentAmount,
    payment.x402,
    payment.mpp,
  );
}
