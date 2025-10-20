import { RequirePaymentConfig, paymentRequiredError, Currency, Network } from "@atxp/common";
import { getATXPConfig, atxpAccountId } from "./atxpContext.js";
import { ATXPConfig } from "./types.js";
import { ATXPAccount, BaseAccount, SolanaAccount, Account } from "@atxp/client";
import { BaseAppAccount } from "@atxp/base";
import { WorldchainAccount } from "@atxp/worldchain";
import BigNumber from "bignumber.js";

/**
 * Get the network for an Account.
 * This is an internal helper function used by requirePayment.
 */
function getNetworkForAccount(destination: Account): Network {
  if (destination instanceof ATXPAccount) {
    return 'atxp';
  } else if (destination instanceof BaseAccount) {
    return 'base';
  } else if (destination instanceof SolanaAccount) {
    return 'solana';
  } else if (destination instanceof BaseAppAccount) {
    return 'base';
  } else if (destination instanceof WorldchainAccount) {
    return 'world';
  } else {
    throw new Error(`Unsupported account type. accountId: ${destination.accountId}`);
  }
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

  // Get network and address from destination Account
  const destinationNetwork = getNetworkForAccount(config.destination);
  const destinationAccountId = config.destination.accountId;
  const destinationAddress = config.destination.accountId; // Address IS accountId

  // Always use multi-destination format
  const charge = {
    destinations: [{
      network: destinationNetwork,
      currency: config.currency,
      address: destinationAddress,
      amount: paymentConfig.price // Destination gets the requested amount for charge
    }],
    source: user,
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
  const paymentRequest = {
    source: charge.source,
    destinationAccountId: charge.destinationAccountId,
    payeeName: charge.payeeName,
    destinations: [{
      network: destinationNetwork,
      currency: config.currency,
      address: destinationAddress,
      amount: paymentAmount // Use minimumPayment or requested amount
    }]
  };

  const paymentId = await config.paymentServer.createPaymentRequest(paymentRequest);
  config.logger.info(`Created payment request ${paymentId}`);
  throw paymentRequiredError(config.server, paymentId, paymentAmount);
}
