import { RequirePaymentConfig, paymentRequiredError, Currency } from "@atxp/common";
import { getATXPConfig, atxpAccountId } from "./atxpContext.js";
import { PaymentAddress, FundingAmount } from "./paymentDestination.js";
import { ATXPConfig } from "./types.js";
import BigNumber from "bignumber.js";

/**
 * Get payment destinations for a user, with caching to avoid repeated HTTP calls.
 * This is an internal helper function used by requirePayment.
 */
async function getPaymentDestinations(
  config: ATXPConfig,
  user: string,
  amount: BigNumber,
  currency: Currency
): Promise<PaymentAddress[]> {
  const fundingAmount: FundingAmount = { amount, currency };
  return await config.paymentDestination.destinations(fundingAmount);
}

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

  // Get payment destinations (with caching)
  const paymentAddresses = await getPaymentDestinations(
    config,
    user,
    paymentAmount,
    config.currency
  );

  // Always use multi-destination format
  const charge = {
    destinations: paymentAddresses.map(addr => ({
      network: addr.network,
      currency: config.currency,
      address: addr.destination,
      accountId: addr.accountId,
      amount: paymentConfig.price // Each destination gets the requested amount for charge
    })),
    source: user,
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
  const paymentRequest = {
    source: charge.source,
    payeeName: charge.payeeName,
    destinations: paymentAddresses.map(addr => ({
      network: addr.network,
      currency: config.currency,
      address: addr.destination,
      accountId: addr.accountId,
      amount: paymentAmount // Use minimumPayment or requested amount
    }))
  };

  const paymentId = await config.paymentServer.createPaymentRequest(paymentRequest);
  config.logger.info(`Created payment request ${paymentId}`);
  throw paymentRequiredError(config.server, paymentId, paymentAmount);
}
