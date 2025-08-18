import { ConsoleLogger } from './logger.js';
import type { AccessToken, ClientCredentials, Logger, OAuthDb, PKCEValues } from './types.js';

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  quit(): Promise<unknown>;
}

export interface RedisOAuthDbConfig {
  redis: RedisClient | string;
  encrypt?: (data: string) => string;
  decrypt?: (data: string) => string;
  logger?: Logger;
  keyPrefix?: string;
  ttl?: number; // TTL in seconds for tokens
}

export class RedisOAuthDb implements OAuthDb {
  private redis: RedisClient | Promise<RedisClient>;
  private encrypt: (data: string) => string;
  private decrypt: (data: string) => string;
  private logger: Logger;
  private keyPrefix: string;
  private ttl?: number;

  constructor({
    redis,
    encrypt = (data: string) => data,
    decrypt = (data: string) => data,
    logger = new ConsoleLogger(),
    keyPrefix = 'oauth:',
    ttl
  }: RedisOAuthDbConfig) {
    if (typeof redis === 'string') {
      // Dynamic import to avoid bundling issues
      this.redis = this.createRedisClient(redis);
    } else {
      this.redis = redis;
    }

    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.logger = logger;
    this.keyPrefix = keyPrefix;
    this.ttl = ttl;
  }

  private async createRedisClient(redisUrl: string): Promise<RedisClient> {
    // Use dynamic import to avoid bundling issues with optional dependencies
    try {
      const { default: Redis } = await import('ioredis');
      return new Redis(redisUrl);
    } catch (error) {
      throw new Error(`Failed to create Redis client from URL "${redisUrl}". Make sure ioredis is installed: npm install ioredis. Error: ${error}`);
    }
  }

  private async getRedisClient(): Promise<RedisClient> {
    if (this.redis instanceof Promise) {
      this.redis = await this.redis; // Resolve once and cache
    }
    return this.redis;
  }

  private getKey(type: string, ...parts: string[]): string {
    return `${this.keyPrefix}${type}:${parts.join(':')}`;
  }

  async getClientCredentials(resourceUrl: string): Promise<ClientCredentials | null> {
    const redis = await this.getRedisClient();
    const key = this.getKey('client_credentials', resourceUrl);
    const data = await redis.get(key);
    
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      return {
        clientId: this.decrypt(parsed.encrypted_client_id),
        clientSecret: this.decrypt(parsed.encrypted_client_secret),
        redirectUri: parsed.redirect_uri
      };
    } catch (error) {
      this.logger.error(`Failed to parse client credentials for ${resourceUrl}: ${error}`);
      return null;
    }
  }

  async saveClientCredentials(resourceUrl: string, credentials: ClientCredentials): Promise<void> {
    const redis = await this.getRedisClient();
    const key = this.getKey('client_credentials', resourceUrl);
    const data = JSON.stringify({
      encrypted_client_id: this.encrypt(credentials.clientId),
      encrypted_client_secret: this.encrypt(credentials.clientSecret),
      redirect_uri: credentials.redirectUri
    });

    await redis.set(key, data);
  }

  async getPKCEValues(userId: string, state: string): Promise<PKCEValues | null> {
    const redis = await this.getRedisClient();
    const key = this.getKey('pkce', userId, state);
    const data = await redis.get(key);
    
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      return {
        codeVerifier: this.decrypt(parsed.encrypted_code_verifier),
        codeChallenge: this.decrypt(parsed.encrypted_code_challenge),
        resourceUrl: parsed.resource_url,
        url: parsed.url
      };
    } catch (error) {
      this.logger.error(`Failed to parse PKCE values for ${userId}:${state}: ${error}`);
      return null;
    }
  }

  async savePKCEValues(userId: string, state: string, values: PKCEValues): Promise<void> {
    const key = this.getKey('pkce', userId, state);
    const data = JSON.stringify({
      encrypted_code_verifier: this.encrypt(values.codeVerifier),
      encrypted_code_challenge: this.encrypt(values.codeChallenge),
      resource_url: values.resourceUrl,
      url: values.url
    });

    // PKCE values are short-lived, set a reasonable TTL (10 minutes)
    const redis = await this.getRedisClient();
    const pkceTtl = 600; // 10 minutes
    await redis.setex(key, pkceTtl, data);
  }

  async getAccessToken(userId: string, url: string): Promise<AccessToken | null> {
    const redis = await this.getRedisClient();
    const key = this.getKey('access_token', userId, url);
    const data = await redis.get(key);
    
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      
      // Check if token is expired
      if (parsed.expires_at) {
        const expiresAt = parseInt(parsed.expires_at);
        if (Date.now() >= expiresAt * 1000) {
          // Token is expired, remove it
          await redis.del(key);
          return null;
        }
      }

      return {
        accessToken: this.decrypt(parsed.encrypted_access_token),
        refreshToken: parsed.encrypted_refresh_token ? this.decrypt(parsed.encrypted_refresh_token) : undefined,
        expiresAt: parsed.expires_at ? parseInt(parsed.expires_at) : undefined,
        resourceUrl: parsed.resource_url
      };
    } catch (error) {
      this.logger.error(`Failed to parse access token for ${userId}:${url}: ${error}`);
      return null;
    }
  }

  async saveAccessToken(userId: string, url: string, token: AccessToken): Promise<void> {
    const redis = await this.getRedisClient();
    const key = this.getKey('access_token', userId, url);
    const data = JSON.stringify({
      resource_url: token.resourceUrl,
      encrypted_access_token: this.encrypt(token.accessToken),
      encrypted_refresh_token: token.refreshToken ? this.encrypt(token.refreshToken) : null,
      expires_at: token.expiresAt?.toString() ?? null
    });

    if (this.ttl) {
      // Use configured TTL
      await redis.setex(key, this.ttl, data);
    } else if (token.expiresAt) {
      // Use token's expiration time
      const ttlSeconds = Math.max(1, token.expiresAt - Math.floor(Date.now() / 1000));
      await redis.setex(key, ttlSeconds, data);
    } else {
      // No expiration, store indefinitely
      await redis.set(key, data);
    }
  }

  async close(): Promise<void> {
    try {
      const redis = await this.getRedisClient();
      await redis.quit();
    } catch (error) {
      this.logger.warn(`Error closing Redis connection: ${error}`);
    }
  }
}