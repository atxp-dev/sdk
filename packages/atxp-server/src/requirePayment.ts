import { RequirePaymentConfig, extractNetworkFromAccountId, extractAddressFromAccountId, Network } from "@atxp/common";
import { BigNumber } from "bignumber.js";
import { getATXPConfig, atxpAccountId, atxpToken } from "./atxpContext.js";
import { buildX402Requirements, buildMppChallenge, omniChallengeMcpError } from "./omniChallenge.js";
import { getATXPResource } from "./atxpContext.js";

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
      amount: paymentConfig.price // Option gets the requested amount for charge
    }],
    sourceAccountId: user,
    destinationAccountId: destinationAccountId,
    payeeName: config.payeeName,
    // Include token for on-demand charging via AccountsOnDemandChargeStrategy
    ...(token && { sourceAccountToken: token }),
  };

  config.logger.debug(`Charging ${paymentConfig.price} to ${charge.options.length} options for source ${user}`);

  const chargeSucceeded = await config.paymentServer.charge(charge);
  if (chargeSucceeded) {
    config.logger.info(`Charged ${paymentConfig.price} for source ${user}`);
    return;
  }

  const existingPaymentId = await paymentConfig.getExistingPaymentId?.();
  if (existingPaymentId) {
    config.logger.info(`Found existing payment ID ${existingPaymentId}`);
    // Use the base charge options (before source expansion) for the omni-challenge
    throw buildOmniError(config, existingPaymentId, paymentAmount, charge.options);
  }

  // For createPaymentRequest, use the minimumPayment if configured
  // Fetch account sources to provide backwards compatibility with old clients
  // that expect multiple payment options (base, solana, world, etc.)
  const options = [{
    network: destinationNetwork,
    currency: config.currency,
    address: destinationAddress,
    amount: paymentAmount // Use minimumPayment or requested amount
  }];

  try {
    // TODO: Remove this once pre-v0.8.0 clients are no longer supported - 0.8.0 only needs 'atxp'
    const sources = await config.destination.getSources();
    config.logger.debug(`Fetched ${sources.length} sources for destination account`);

    // Add each source as an alternative payment option
    for (const source of sources) {
      options.push({
        network: source.chain as Network, // Chain and Network have compatible values
        currency: config.currency,
        address: source.address,
        amount: paymentAmount
      });
    }
    config.logger.debug(`Payment request will include ${options.length} total options`);
  } catch (error) {
    config.logger.warn(`Failed to fetch account sources, will use ATXP option only: ${error}`);
    // Continue with just the ATXP option if sources fetch fails
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
  throw buildOmniError(config, paymentId, paymentAmount, options);
}

/**
 * Build an omni-challenge MCP error that includes ATXP-MCP + X402 + MPP data.
 * This enables clients to detect and respond to any supported protocol.
 */
function buildOmniError(
  config: { server: import("@atxp/common").AuthorizationServerUrl; logger: import("@atxp/common").Logger },
  paymentId: string,
  paymentAmount: BigNumber,
  options: Array<{ network: string; currency: string; address: string; amount: BigNumber }>,
) {
  const resource = getATXPResource()?.toString() ?? '';

  const x402Requirements = buildX402Requirements({
    options,
    resource,
    payeeName: '',
  });

  if (x402Requirements.accepts.length === 0 && options.length > 0) {
    config.logger.warn(`buildX402Requirements filtered all ${options.length} options — no X402-compatible networks (base/base_sepolia with 0x address). X402 clients will not see any payment options.`);
  }

  // Include MPP challenge if any option is on Tempo
  const mppChallenge = buildMppChallenge({ id: paymentId, options });

  return omniChallengeMcpError(
    config.server,
    paymentId,
    paymentAmount,
    x402Requirements,
    mppChallenge,
  );
}
