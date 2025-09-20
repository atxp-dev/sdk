import { RequirePaymentConfig, paymentRequiredError } from "@atxp/common";
import { getATXPConfig, atxpAccountId } from "./atxpContext.js";
import { PaymentAddress } from "./paymentDestination.js";

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

  const fundingAmount = {
    amount: paymentConfig.price,
    currency: config.currency
  };

  // Get payment destinations - use destinations() if available, otherwise wrap destination() in array
  let paymentAddresses: PaymentAddress[];
  if ('destinations' in config.paymentDestination && typeof config.paymentDestination.destinations === 'function') {
    paymentAddresses = await config.paymentDestination.destinations(fundingAmount, user);
  } else {
    // Fallback to single destination wrapped in array
    const singleAddress = await config.paymentDestination.destination(fundingAmount, user);
    paymentAddresses = [singleAddress];
  }

  // Always use multi-destination format
  const charge = {
    destinations: paymentAddresses.map(addr => ({
      network: addr.network,
      currency: config.currency,
      address: addr.destination,
      amount: paymentConfig.price // Each destination gets the full amount
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
    throw paymentRequiredError(config.server, existingPaymentId, charge.amount)
  }

  const paymentId = await config.paymentServer.createPaymentRequest(charge);
  config.logger.info(`Created payment request ${paymentId}`);
  throw paymentRequiredError(config.server, paymentId, charge.amount);
}
