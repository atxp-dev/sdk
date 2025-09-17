import { RequirePaymentConfig, paymentRequiredError } from "@atxp/common";
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

  const fundingAmount = {
    amount: paymentConfig.price,
    currency: config.currency
  };

  const fundingDestination = config.paymentDestination.destination(fundingAmount, user);

  const charge = {
    amount: paymentConfig.price,
    currency: config.currency,
    network: fundingDestination.network,
    destination: fundingDestination.destination,
    source: user,
    payeeName: config.payeeName,
  };

  config.logger.debug(`Charging amount ${charge.amount}, destination ${charge.destination}, source ${charge.source}`);
  const chargeResponse = await config.paymentServer.charge(charge);
  if (chargeResponse.success) {
    config.logger.info(`Charged ${charge.amount} for source ${charge.source}`);
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
