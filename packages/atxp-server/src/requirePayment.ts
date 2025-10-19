import { RequirePaymentConfig, paymentRequiredError, Currency, Network } from "@atxp/common";
import { getATXPConfig, atxpAccountId } from "./atxpContext.js";
import { ATXPConfig } from "./types.js";
import { ATXPAccount, BaseAccount, SolanaAccount } from "@atxp/client";
import { BaseAppAccount } from "@atxp/base";
import { WorldchainAccount } from "@atxp/worldchain";
import BigNumber from "bignumber.js";

type PaymentAddress = {
  destination: string;
  network: Network;
  accountId: string | null;
};

/**
 * Get payment destination information from an Account.
 * This is an internal helper function used by requirePayment.
 */
function getPaymentDestination(
  destination: ATXPConfig['destination']
): PaymentAddress {
  // Validate accountId is non-empty
  if (!destination.accountId || destination.accountId.trim() === '') {
    throw new Error('Account accountId cannot be empty');
  }

  let destinationAddress: string;
  let destinationNetwork: Network;
  let destinationAccountId: string | null;

  if (destination instanceof ATXPAccount) {
    destinationAddress = destination.accountId;
    destinationNetwork = 'atxp_base';
    destinationAccountId = destination.accountId;  // ATXP account
  } else if (destination instanceof BaseAccount) {
    destinationAddress = destination.accountId;
    destinationNetwork = 'base';
    destinationAccountId = destination.accountId;  // Changed from null
  } else if (destination instanceof SolanaAccount) {
    destinationAddress = destination.accountId;
    destinationNetwork = 'solana';
    destinationAccountId = destination.accountId;  // Changed from null
  } else if (destination instanceof BaseAppAccount) {
    destinationAddress = destination.accountId;
    destinationNetwork = 'base';
    destinationAccountId = destination.accountId;  // Changed from null
  } else if (destination instanceof WorldchainAccount) {
    destinationAddress = destination.accountId;
    destinationNetwork = 'world';
    destinationAccountId = destination.accountId;  // Changed from null
  } else {
    // Exhaustiveness check - throw error for unknown account types
    // This will fail at runtime if a new Account type is added without updating this function
    throw new Error(`Unsupported account type. accountId: ${destination.accountId}. Please update getPaymentDestination() to handle this account type.`);
  }

  return {
    destination: destinationAddress,
    network: destinationNetwork,
    accountId: destinationAccountId
  };
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

  // Get payment destination from the Account
  const paymentAddress = getPaymentDestination(config.destination);

  // Always use multi-destination format
  const charge = {
    destinations: [{
      network: paymentAddress.network,
      currency: config.currency,
      address: paymentAddress.destination,
      amount: paymentConfig.price // Destination gets the requested amount for charge
    }],
    source: user,
    destinationAccountId: paymentAddress.accountId,
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
      network: paymentAddress.network,
      currency: config.currency,
      address: paymentAddress.destination,
      amount: paymentAmount // Use minimumPayment or requested amount
    }]
  };

  const paymentId = await config.paymentServer.createPaymentRequest(paymentRequest);
  config.logger.info(`Created payment request ${paymentId}`);
  throw paymentRequiredError(config.server, paymentId, paymentAmount);
}
