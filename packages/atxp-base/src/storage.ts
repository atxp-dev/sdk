import { SpendPermission } from './types.js';
import { Hex } from '@atxp/client';
import { type IStorage, JsonStorage, BrowserStorage, MemoryStorage } from '@atxp/common';

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
 * Type-safe storage wrapper for permission data
 */
export class IntermediaryStorage extends JsonStorage<Intermediary> {}

// Re-export shared storage classes for backward compatibility
export { type IStorage, BrowserStorage, MemoryStorage };
