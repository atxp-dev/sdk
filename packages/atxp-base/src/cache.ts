import { SpendPermission } from './types.js';
import { Hex } from '@atxp/client';
import { type ICache, JsonCache, BrowserCache, MemoryCache } from '@atxp/common';

/**
 * Stored permission data structure
 */
export interface Intermediary {
  /** Ephemeral wallet private key */
  privateKey: Hex;
  /** Spend permission from Base */
  permission: SpendPermission;
}

/**
 * Type-safe cache wrapper for permission data
 */
export class IntermediaryCache extends JsonCache<Intermediary> {}

// Re-export shared cache classes
export { type ICache, BrowserCache, MemoryCache };
