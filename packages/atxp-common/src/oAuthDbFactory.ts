import { OAuthDb, Logger } from './types.js';
import { SqliteOAuthDb, OAuthDbConfig } from './oAuthDb.js';
import { MemoryOAuthDb, MemoryOAuthDbConfig } from './memoryOAuthDb.js';
import { RedisOAuthDb, RedisOAuthDbConfig } from './redisOAuthDb.js';

export interface OAuthDbFactoryConfig {
  db?: string;
  encrypt?: (data: string) => string;
  decrypt?: (data: string) => string;
  logger?: Logger;
}

/**
 * Factory function that creates the appropriate OAuthDb implementation.
 * Uses RedisOAuthDb when Redis client or URL is provided.
 * Uses MemoryOAuthDb for ':memory:' databases to avoid SQLite dependency.
 * Uses SqliteOAuthDb for persistent storage.
 */
export function createOAuthDb(config: OAuthDbFactoryConfig = {}): OAuthDb {
  const { db = SqliteOAuthDb.getDefaultDbPath(), ...otherConfig } = config;
    
  // Use in-memory implementation for ':memory:' databases
  if (db === ':memory:') {
    return new MemoryOAuthDb({ logger: otherConfig.logger });
  }
  
  // Use SQLite implementation for persistent storage
  return new SqliteOAuthDb({ db, ...otherConfig });
}

/**
 * Convenience function for creating an in-memory OAuth database
 */
export function createMemoryOAuthDb(config: MemoryOAuthDbConfig = {}): MemoryOAuthDb {
  return new MemoryOAuthDb(config);
}

/**
 * Convenience function for creating a SQLite OAuth database
 */
export function createSqliteOAuthDb(config: OAuthDbConfig = {}): SqliteOAuthDb {
  return new SqliteOAuthDb(config);
}

/**
 * Convenience function for creating a Redis OAuth database
 */
export function createRedisOAuthDb(config: RedisOAuthDbConfig): RedisOAuthDb {
  return new RedisOAuthDb(config);
}