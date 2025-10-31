import { RequirePaymentConfig, paymentRequiredError, extractNetworkFromAccountId, extractAddressFromAccountId } from "@atxp/common";
import { getATXPConfig, atxpAccountId } from "./atxpContext.js";

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
  const destinationAccountId = config.destination.accountId;
  const destinationNetwork = extractNetworkFromAccountId(destinationAccountId);
  const destinationAddress = extractAddressFromAccountId(destinationAccountId);

  // Always use multi-destination format
  const charge = {
    source: user,
    destinations: [{
      network: destinationNetwork,
      currency: config.currency,
      address: destinationAddress,
      amount: paymentConfig.price // Destination gets the requested amount for charge
    }],
    sourceAccountId: user,
    destinationAccountId: destinationAccountId,
    payeeName: config.payeeName,
  };

  config.logger.debug(`Charging ${paymentConfig.price} to ${charge.destinations.length} destinations for source ${user}`);

  const chargeResponse = await config.paymentServer.charge(charge);
  if (chargeResponse.success) {
    config.logger.info(`Charged ${paymentConfig.price} for source ${user}`);
    return;
  }

  const existingPaymentId = await paymentConfig.getExistingPaymentId?.();
  if (existingPaymentId) {
    config.logger.info(`Found existing payment ID ${existingPaymentId}`);
    throw paymentRequiredError(config.server, existingPaymentId, paymentAmount)
  }

  // For createPaymentRequest, use the minimumPayment if configured
  // Fetch account sources to provide backwards compatibility with old clients
  // that expect multiple payment destination options (base, solana, world, etc.)
  let destinations = [{
    network: destinationNetwork,
    currency: config.currency,
    address: destinationAddress,
    amount: paymentAmount // Use minimumPayment or requested amount
  }];

  try {
    // TODO: Remove this once pre-v0.8.0 clients are no longer supported - 0.8.0 only needs 'atxp'
    const sources = await config.destination.getSources();
    config.logger.debug(`Fetched ${sources.length} sources for destination account`);

    // Add each source as an alternative payment destination
    for (const source of sources) {
      destinations.push({
        network: source.chain as any, // Chain and Network have compatible values
        currency: config.currency,
        address: source.address,
        amount: paymentAmount
      });
    }
    config.logger.debug(`Payment request will include ${destinations.length} total destinations`);
  } catch (error) {
    config.logger.warn(`Failed to fetch account sources, will use ATXP destination only: ${error}`);
    // Continue with just the ATXP destination if sources fetch fails
  }

  const paymentRequest = {
    source: user,
    sourceAccountId: user,
    destinationAccountId: destinationAccountId,
    payeeName: config.payeeName,
    destinations
  };

  config.logger.debug(`Creating payment request with sourceAccountId: ${user}, destinationAccountId: ${charge.destinationAccountId}`);
  const paymentId = await config.paymentServer.createPaymentRequest(paymentRequest);
  config.logger.info(`Created payment request ${paymentId}`);
  throw paymentRequiredError(config.server, paymentId, paymentAmount);
}
