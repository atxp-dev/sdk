import { OAuthDb, Logger } from './types.js';
import { MemoryOAuthDb, MemoryOAuthDbConfig } from './memoryOAuthDb.js';

export interface OAuthDbFactoryConfig {
  db?: string;
  encrypt?: (data: string) => string;
  decrypt?: (data: string) => string;
  logger?: Logger;
}

/**
 * Factory function that creates the appropriate OAuthDb implementation.
 * Note: SQLite and Redis implementations have been moved to separate packages.
 * This factory now only supports the MemoryOAuthDb implementation.
 * For SQLite support, import from '@atxp/sqlite-db'
 * For Redis support, import from '@atxp/redis-db'
 */
export function createOAuthDb(config: OAuthDbFactoryConfig = {}): OAuthDb {
  const { db = ':memory:', ...otherConfig } = config;
    
  // Use in-memory implementation
  if (db === ':memory:') {
    return new MemoryOAuthDb({ logger: otherConfig.logger });
  }
  
  throw new Error('SQLite and Redis database implementations have been moved to separate packages. Use @atxp/sqlite-db for SQLite or @atxp/redis-db for Redis.');
}

/**
 * Convenience function for creating an in-memory OAuth database
 */
export function createMemoryOAuthDb(config: MemoryOAuthDbConfig = {}): MemoryOAuthDb {
  return new MemoryOAuthDb(config);
}