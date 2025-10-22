import { Logger } from '@atxp/common';

/**
 * Represents a payment destination that can be mapped/transformed
 */
// TODO: Update Destination to use proper types once we are done refactoring
export interface Destination {
  network: string;
  currency: string;
  address: string;
  amount: string;
}

/**
 * Interface for destination mappers that transform payment destinations.
 * Each mapper takes an array of destinations and returns a transformed array.
 * Mappers can expand single destinations into multiple (e.g., ATXP -> multiple chains),
 * modify existing destinations, or pass them through unchanged.
 */
export interface DestinationMapper {
  /**
   * Map/transform a set of destinations
   * @param destinations The input destinations to potentially transform
   * @param logger Optional logger for debugging
   * @returns A promise that resolves to the transformed destinations
   */
  mapDestinations(destinations: Destination[], logger?: Logger): Promise<Destination[]>;
}

/**
 * A pass-through destination mapper that returns destinations unchanged.
 * Useful as a default or for testing.
 */
export class IdentityDestinationMapper implements DestinationMapper {
  async mapDestinations(destinations: Destination[]): Promise<Destination[]> {
    return destinations;
  }
}