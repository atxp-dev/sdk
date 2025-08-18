import { OAuthDb, ClientCredentials, PKCEValues, AccessToken, Logger, LogLevel } from './types.js';
import { ConsoleLogger } from './logger.js';

export interface MemoryOAuthDbConfig {
  logger?: Logger;
}

export class MemoryOAuthDb implements OAuthDb {
  private clientCredentials = new Map<string, ClientCredentials>();
  private pkceValues = new Map<string, PKCEValues>(); // key: `${userId}:${state}`
  private accessTokens = new Map<string, AccessToken>(); // key: `${userId}:${url}`
  private logger: Logger;

  constructor(config: MemoryOAuthDbConfig = {}) {
    this.logger = config.logger || new ConsoleLogger({ prefix: '[memory-oauth-db]', level: LogLevel.INFO });
    this.logger.info(`Initialized in-memory OAuth database (instance: ${Math.random().toString(36).substr(2, 9)})`);
  }

  // OAuthResourceDb methods
  async getClientCredentials(serverUrl: string): Promise<ClientCredentials | null> {
    const credentials = this.clientCredentials.get(serverUrl) || null;
    if (credentials) {
      this.logger.debug(`Getting client credentials for server: ${serverUrl} (cached)`);
    } else {
      this.logger.info(`Getting client credentials for server: ${serverUrl} (not cached)`);
      this.logger.debug(`Available keys in cache: ${Array.from(this.clientCredentials.keys()).join(', ')}`);
    }
    return credentials;
  }

  async saveClientCredentials(serverUrl: string, credentials: ClientCredentials): Promise<void> {
    this.logger.info(`Saving client credentials for server: ${serverUrl}`);
    this.logger.debug(`Client credentials: clientId=${credentials.clientId}`);
    this.clientCredentials.set(serverUrl, credentials);
  }

  // OAuthDb methods
  async getPKCEValues(userId: string, state: string): Promise<PKCEValues | null> {
    const key = `${userId}:${state}`;
    this.logger.info(`Getting PKCE values for user: ${userId}, state: ${state}`);
    return this.pkceValues.get(key) || null;
  }

  async savePKCEValues(userId: string, state: string, values: PKCEValues): Promise<void> {
    const key = `${userId}:${state}`;
    this.logger.info(`Saving PKCE values for user: ${userId}, state: ${state}`);
    this.pkceValues.set(key, values);
  }

  async getAccessToken(userId: string, url: string): Promise<AccessToken | null> {
    const key = `${userId}:${url}`;
    this.logger.info(`Getting access token for user: ${userId}, url: ${url}`);
    
    const token = this.accessTokens.get(key);
    if (!token) {
      this.logger.debug(`No cached token found for key: ${key}`);
      return null;
    }

    // Check if token has expired
    if (token.expiresAt && token.expiresAt < Date.now()) {
      this.logger.info(`Access token expired for user: ${userId}, url: ${url}`);
      this.accessTokens.delete(key);
      return null;
    }

    this.logger.debug(`Found valid cached token for user: ${userId}, url: ${url}`);
    return token;
  }

  async saveAccessToken(userId: string, url: string, token: AccessToken): Promise<void> {
    const key = `${userId}:${url}`;
    const existingToken = this.accessTokens.get(key);
    if (existingToken) {
      this.logger.debug(`Updating access token for user: ${userId}, url: ${url}`);
    } else {
      this.logger.info(`Saving new access token for user: ${userId}, url: ${url}`);
    }
    this.accessTokens.set(key, token);
  }

  async close(): Promise<void> {
    this.logger.info('Closing in-memory OAuth database');
    this.clientCredentials.clear();
    this.pkceValues.clear();
    this.accessTokens.clear();
  }

  // Utility methods for debugging/monitoring
  getStats() {
    return {
      clientCredentials: this.clientCredentials.size,
      pkceValues: this.pkceValues.size,
      accessTokens: this.accessTokens.size
    };
  }

  // Clean up expired tokens periodically
  cleanupExpiredTokens(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, token] of this.accessTokens.entries()) {
      if (token.expiresAt && token.expiresAt < now) {
        this.accessTokens.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} expired access tokens`);
    }
    
    return cleaned;
  }
}