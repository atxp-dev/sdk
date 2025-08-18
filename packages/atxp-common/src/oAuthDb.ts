import { sqlite, SQLiteDatabase } from './platform/index.js';
import { ConsoleLogger } from './logger.js';
import type { AccessToken, ClientCredentials, Logger, OAuthDb, PKCEValues } from './types.js';

export interface OAuthDbConfig {
  db?: string | SQLiteDatabase;
  encrypt?: (data: string) => string;
  decrypt?: (data: string) => string;
  logger?: Logger;
}

export class SqliteOAuthDb implements OAuthDb {
  private db: SQLiteDatabase;
  private initialized = false;
  private encrypt: (data: string) => string;
  private decrypt: (data: string) => string;
  private logger: Logger;

  static getDefaultDbPath(): string {
    return 'oauthClient.db';
  }

  constructor({
    db = SqliteOAuthDb.getDefaultDbPath(),
    encrypt = (data: string) => data,
    decrypt = (data: string) => data,
    logger = new ConsoleLogger()
  }: OAuthDbConfig = {}) {
    this.db = typeof db === 'string' ? sqlite.openDatabase(db) : db;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.logger = logger;
  }

  ensureInitialized = async (): Promise<void> => {
    if (this.initialized) return;

    // Create tables
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS oauth_client_credentials (
        resource_url TEXT PRIMARY KEY,
        encrypted_client_id TEXT NOT NULL,
        encrypted_client_secret TEXT NOT NULL,
        redirect_uri TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_pkce_values (
        user_id TEXT NOT NULL,
        state TEXT NOT NULL,
        encrypted_code_verifier TEXT NOT NULL,
        encrypted_code_challenge TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        url TEXT NOT NULL,
        PRIMARY KEY (user_id, state)
      );

      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        user_id TEXT NOT NULL,
        url TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT,
        expires_at TEXT,
        PRIMARY KEY (user_id, url)
      );
    `);

    this.initialized = true;
  }

  getClientCredentials = async (resourceUrl: string): Promise<ClientCredentials | null> => {
    await this.ensureInitialized();
    const preparedRow = await this.db.prepareAsync(
      'SELECT encrypted_client_id, encrypted_client_secret, redirect_uri FROM oauth_client_credentials WHERE resource_url = ?'
    );
    try {
      const rowIterator = await preparedRow.executeAsync<{ encrypted_client_id: string; encrypted_client_secret: string; redirect_uri: string }>(resourceUrl);
      const row = await rowIterator.getFirstAsync();
      return row ? {
        clientId: this.decrypt(row.encrypted_client_id),
        clientSecret: this.decrypt(row.encrypted_client_secret),
        redirectUri: row.redirect_uri
      } : null;
    } finally {
      await preparedRow.finalizeAsync();
    }
  }

  saveClientCredentials = async (
    resourceUrl: string,
    credentials: ClientCredentials
  ): Promise<void> => {
    await this.ensureInitialized();
    const statement = await this.db.prepareAsync(
      'INSERT OR REPLACE INTO oauth_client_credentials (resource_url, encrypted_client_id, encrypted_client_secret, redirect_uri) VALUES (?, ?, ?, ?)'
    );
    try {
      await statement.executeAsync(
        resourceUrl,
        this.encrypt(credentials.clientId),
        this.encrypt(credentials.clientSecret),
        credentials.redirectUri
      );
    } finally {
      await statement.finalizeAsync();
    }
  }

  getPKCEValues = async (userId: string, state: string): Promise<PKCEValues | null> => {
    await this.ensureInitialized();
    const statement = await this.db.prepareAsync(
      'SELECT encrypted_code_verifier, encrypted_code_challenge, resource_url, url FROM oauth_pkce_values WHERE user_id = ? AND state = ?'
    );
    try {
      const result = await statement.executeAsync<{ encrypted_code_verifier: string; encrypted_code_challenge: string; resource_url: string; url: string }>(userId, state);
      const row = await result.getFirstAsync();

      return row ? {
        codeVerifier: this.decrypt(row.encrypted_code_verifier),
        codeChallenge: this.decrypt(row.encrypted_code_challenge),
        resourceUrl: row.resource_url,
        url: row.url
      } : null;
    } finally {
      await statement.finalizeAsync();
    }
  }

  savePKCEValues = async (
    userId: string,
    state: string,
    values: PKCEValues
  ): Promise<void> => {
    await this.ensureInitialized();
    const statement = await this.db.prepareAsync(
      'INSERT INTO oauth_pkce_values (user_id, state, encrypted_code_verifier, encrypted_code_challenge, resource_url, url) VALUES (?, ?, ?, ?, ?, ?)'
    );
    try {
      await statement.executeAsync(
        userId,
        state,
        this.encrypt(values.codeVerifier),
        this.encrypt(values.codeChallenge),
        values.resourceUrl,
        values.url
      );
    } finally {
      await statement.finalizeAsync();
    }
  }

  getAccessToken = async (userId: string, url: string): Promise<AccessToken | null> => {
    await this.ensureInitialized();
    const statement = await this.db.prepareAsync(
      'SELECT resource_url, encrypted_access_token, encrypted_refresh_token, expires_at FROM oauth_access_tokens WHERE user_id = ? AND url = ?'
    );
    try {
      const result = await statement.executeAsync<{ resource_url: string; encrypted_access_token: string; encrypted_refresh_token: string | null; expires_at: string | null }>(userId, url);
      const row = await result.getFirstAsync();

      if (!row) return null;

      return {
        accessToken: this.decrypt(row.encrypted_access_token),
        refreshToken: row.encrypted_refresh_token ? this.decrypt(row.encrypted_refresh_token) : undefined,
        expiresAt: row.expires_at ? parseInt(row.expires_at) : undefined,
        resourceUrl: row.resource_url
      };
    } finally {
      await statement.finalizeAsync();
    }
  }

  saveAccessToken = async (
    userId: string,
    url: string,
    token: AccessToken
  ): Promise<void> => {
    await this.ensureInitialized();
    const statement = await this.db.prepareAsync(
      'INSERT OR REPLACE INTO oauth_access_tokens (user_id, url, resource_url, encrypted_access_token, encrypted_refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    try {
      await statement.executeAsync(
        userId,
        url,
        token.resourceUrl,
        this.encrypt(token.accessToken),
        token.refreshToken ? this.encrypt(token.refreshToken) : null,
        token.expiresAt?.toString() ?? null
      );
    } finally {
      await statement.finalizeAsync();
    }
  }

  close = async (): Promise<void> => {
    try {
      await this.db.closeAsync();
    } catch (error) {
      // If database is already closed, just log and continue
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_MISUSE') {
        this.logger.warn('Database already closed');
      } else {
        throw error;
      }
    }
  }
}