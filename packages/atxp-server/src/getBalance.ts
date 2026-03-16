import { BigNumber } from "bignumber.js";
import { getATXPConfig, atxpAccountId, atxpToken } from "./atxpContext.js";

/**
 * Get the current user's available balance.
 *
 * Uses the ATXP context (config, accountId, token) to call the auth server's
 * POST /balance endpoint. Returns the available balance as a BigNumber in USD.
 *
 * @returns The user's available balance
 * @throws Error if no config or user is found, or if the balance lookup fails
 *
 * @example
 * ```typescript
 * import { getBalance } from '@atxp/server';
 *
 * const balance = await getBalance();
 * if (balance.lt(requiredAmount)) {
 *   // User can't afford this operation
 * }
 * ```
 */
export async function getBalance(): Promise<BigNumber> {
  const config = getATXPConfig();
  if (!config) {
    throw new Error('No config found');
  }
  const user = atxpAccountId();
  if (!user) {
    config.logger.error('No user found');
    throw new Error('No user found');
  }

  const destinationAccountId = await config.destination.getAccountId();
  const token = atxpToken();

  const balanceRequest = {
    sourceAccountId: user,
    destinationAccountId,
    ...(token && { sourceAccountToken: token }),
  };

  config.logger.debug(`Getting balance for source ${user}`);

  const balance = await config.paymentServer.getBalance(balanceRequest);

  config.logger.debug(`Balance for source ${user}: ${balance}`);

  return balance;
}
