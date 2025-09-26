import { RequirePaymentConfig, paymentRequiredError, Currency } from "@atxp/common";
import { getATXPConfig, atxpAccountId } from "./atxpContext.js";
import { PaymentAddress, FundingAmount } from "./paymentDestination.js";
import { ATXPConfig } from "./types.js";
import BigNumber from "bignumber.js";

// Cache for payment destinations to avoid repeated HTTP calls
// Key is "userId:amount:currency", value is cached destinations
const destinationCache = new Map<string, {
  destinations: PaymentAddress[];
  timestamp: number;
}>();

// Cache duration: 5 minutes
const CACHE_DURATION_MS = 5 * 60 * 1000;

/**
 * Get payment destinations for a user, with caching to avoid repeated HTTP calls.
 * This is an internal helper function used by requirePayment.
 */
async function getCachedPaymentDestinations(
  config: ATXPConfig,
  user: string,
  amount: BigNumber,
  currency: Currency
): Promise<PaymentAddress[]> {
  const cacheKey = `${user}:${amount.toString()}:${currency}`;
  const cached = destinationCache.get(cacheKey);
  const now = Date.now();

  // Return cached destinations if still valid
  if (cached && (now - cached.timestamp) < CACHE_DURATION_MS) {
    config.logger.debug(`Using cached payment destinations for user ${user}`);
    return cached.destinations;
  }

  // Fetch fresh destinations
  config.logger.debug(`Fetching payment destinations for user ${user}`);

  const fundingAmount: FundingAmount = { amount, currency };
  let paymentAddresses: PaymentAddress[];

  if ('destinations' in config.paymentDestination && typeof config.paymentDestination.destinations === 'function') {
    paymentAddresses = await config.paymentDestination.destinations(fundingAmount, user);
  } else {
    // Fallback to single destination wrapped in array
    const singleAddress = await config.paymentDestination.destination(fundingAmount, user);
    paymentAddresses = [singleAddress];
  }

  // Cache the result
  destinationCache.set(cacheKey, {
    destinations: paymentAddresses,
    timestamp: now
  });

  config.logger.debug(`Cached ${paymentAddresses.length} payment destinations for user ${user}`);
  return paymentAddresses;
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
  const paymentAddresses = await getCachedPaymentDestinations(
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
    ...charge,
    amount: paymentAmount,
    destinations: paymentAddresses.map(addr => ({
      network: addr.network,
      currency: config.currency,
      address: addr.destination,
      amount: paymentAmount // Use minimumPayment or requested amount
    }))
  };

  const paymentId = await config.paymentServer.createPaymentRequest(paymentRequest);
  config.logger.info(`Created payment request ${paymentId}`);
  throw paymentRequiredError(config.server, paymentId, paymentAmount);
}
