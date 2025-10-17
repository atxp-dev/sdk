import { BigNumber } from "bignumber.js";
import { Currency, FetchLike, Logger, Network } from "@atxp/common";
import { PaymentDestination } from "./types.js";

/**
 * DestinationMapper maps abstract destinations to concrete destinations.
 *
 * This is a generic interface - implementations may call external services,
 * but the interface itself doesn't know about specific services.
 */
export interface DestinationMapper {
  /**
   * Maps an abstract destination (like ATXP URL) to concrete destinations
   *
   * @param destination - The destination to map
   * @param sourceAddresses - Array of {network, address} pairs from all payment makers
   *
   * @returns Array of concrete destinations. If mapper can't handle destination,
   *          returns original destination unchanged in array.
   *
   * CRITICAL: Do NOT return null or empty array. If mapper can't handle destination,
   * return [destination] unchanged. This allows all mappers to be tried to build
   * largest possible destination array.
   */
  mapDestination(
    destination: PaymentDestination,
    sourceAddresses: Array<{network: Network, address: string}>
  ): Promise<PaymentDestination[]>;
}

/**
 * ATXPDestinationMapper resolves ATXP account IDs to concrete payment destinations.
 *
 * This mapper calls the ATXP accounts service to resolve destinations with network='atxp'
 * and address={accountId} into concrete destinations (e.g., Stripe base address,
 * or cross-chain base + solana addresses).
 *
 * For ATXP destinations, the address field contains just the account ID (e.g., 'acct_123'),
 * not a full URL. The mapper constructs the payment_info endpoint URL internally.
 *
 * The accounts service is an implementation detail - the DestinationMapper interface
 * itself is generic and doesn't know about accounts service.
 */
export class ATXPDestinationMapper implements DestinationMapper {
  constructor(
    private fetchFn: FetchLike,
    private logger: Logger
  ) {}

  async mapDestination(
    destination: PaymentDestination,
    sourceAddresses: Array<{network: Network, address: string}>
  ): Promise<PaymentDestination[]> {

    // Check if this is an ATXP network destination
    if (destination.network !== 'atxp') {
      // Not an ATXP destination, return unchanged
      return [destination];
    }

    // For ATXP network, the address IS the account ID
    const accountId = destination.address;
    const paymentInfoEndpoint = `https://accounts.atxp.ai/payment_info/${accountId}`;

    // Build buyerAddresses object from sourceAddresses array
    const buyerAddresses: Record<string, string> = {};
    for (const {network, address} of sourceAddresses) {
      buyerAddresses[network] = address;
    }

    try {
      this.logger.debug(`Calling payment_info for ATXP account ${accountId}`);

      const response = await this.fetchFn(paymentInfoEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentRequestId: destination.paymentRequestId,
          buyerAddresses
        })
      });

      if (!response.ok) {
        this.logger.warn(`payment_info call failed: ${response.status}`);
        return [destination];  // Return unchanged, not null
      }

      const data = await response.json() as {
        destinations: Array<{
          network: Network;
          address: string;
          amount?: string;
          currency?: Currency;
        }>;
      };

      if (!data.destinations || data.destinations.length === 0) {
        this.logger.warn('payment_info returned no destinations');
        return [destination];
      }

      this.logger.info(`ATXP mapped to ${data.destinations.length} concrete destination(s)`);

      // Return all destinations (1-to-many mapping)
      // Accounts service decides what to return (Stripe base, direct base + solana, etc.)
      return data.destinations.map(dest => ({
        network: dest.network,
        address: dest.address,
        amount: dest.amount ? new BigNumber(dest.amount) : destination.amount,
        currency: dest.currency || destination.currency,
        paymentRequestId: destination.paymentRequestId,
        accountId: destination.accountId
      }));

    } catch (error) {
      this.logger.warn(`Error mapping ATXP destination: ${error}`);
      return [destination];  // Return unchanged on error
    }
  }
}
