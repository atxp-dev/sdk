# @atxp/sqlite

ATXP SQLite Database - SQLite OAuth database implementation for Authorization Token Exchange Protocol.

## Overview

The ATXP SQLite Database package provides persistent OAuth token storage using SQLite. It's designed to work seamlessly with `@atxp/client` and `@atxp/server` packages when you need persistent storage that survives application restarts.

## Features

- 🗄️ **Persistent Storage**: SQLite-based OAuth token persistence
- 🔐 **Encryption Support**: Optional encryption for sensitive token data  
- 🌍 **Node.js Only**: SQLite implementation using `better-sqlite3`
- 🔄 **Auto-Migration**: Automatic database schema creation and updates
- 🛡️ **Type Safety**: Full TypeScript support

## Installation

```bash
npm install @atxp/sqlite
```

### Dependencies

- **Node.js**: Automatically installs `better-sqlite3`
- **React Native/Expo**: Not currently supported (use `MemoryOAuthDb` from `@atxp/common`)

## Basic Usage

```typescript
import { SqliteOAuthDb } from '@atxp/sqlite';

// Create database instance
const db = new SqliteOAuthDb({
  db: 'oauth.db'  // File path for database
});

// Use with ATXP client
import { ATXPClient } from '@atxp/client';

const client = new ATXPClient({
  serverUrl: 'http://localhost:3010',
  clientId: 'your-oauth-client-id',
  oAuthDb: db  // Use persistent SQLite storage
});
```

## Configuration Options

```typescript
interface OAuthDbConfig {
  db?: string;                    // Database file path (default: 'oauthClient.db')
  encrypt?: (data: string) => string;  // Optional encryption function
  decrypt?: (data: string) => string;  // Optional decryption function  
  logger?: Logger;                // Optional custom logger
}
```

## Encryption Example

```typescript
import { SqliteOAuthDb } from '@atxp/sqlite';
import { createCipher, createDecipher } from 'crypto';

const encryptionKey = 'your-encryption-key';

const db = new SqliteOAuthDb({
  db: 'encrypted-oauth.db',
  encrypt: (data: string) => {
    // Implement your encryption logic
    return encrypt(data, encryptionKey);
  },
  decrypt: (data: string) => {
    // Implement your decryption logic  
    return decrypt(data, encryptionKey);
  }
});
```

## Database Schema

The SQLite database automatically creates the following tables:

### `oauth_client_credentials`
- `resource_url` (TEXT PRIMARY KEY)
- `encrypted_client_id` (TEXT NOT NULL)  
- `encrypted_client_secret` (TEXT NOT NULL)
- `redirect_uri` (TEXT NOT NULL)

### `oauth_pkce_values`
- `user_id` (TEXT NOT NULL)
- `state` (TEXT NOT NULL)
- `encrypted_code_verifier` (TEXT NOT NULL)
- `encrypted_code_challenge` (TEXT NOT NULL)
- `resource_url` (TEXT NOT NULL)
- `url` (TEXT NOT NULL)
- PRIMARY KEY (`user_id`, `state`)

### `oauth_access_tokens`
- `user_id` (TEXT NOT NULL)
- `url` (TEXT NOT NULL)  
- `resource_url` (TEXT NOT NULL)
- `encrypted_access_token` (TEXT NOT NULL)
- `encrypted_refresh_token` (TEXT)
- `expires_at` (TEXT)
- PRIMARY KEY (`user_id`, `url`)

## Platform-Specific Notes

### Node.js
- Uses `better-sqlite3` for optimal performance
- Supports file-based databases with full path support
- Automatic dependency installation

### React Native/Expo
React Native support is not currently implemented. For React Native applications, use `MemoryOAuthDb` from `@atxp/common` for development, or implement a custom database adapter using React Native AsyncStorage or similar.

## Migration from @atxp/common

If you were previously using the built-in SQLite functionality from `@atxp/common`:

```typescript
// Old (no longer available)
import { SqliteOAuthDb } from '@atxp/common';

// New
import { SqliteOAuthDb } from '@atxp/sqlite';
```

The API remains exactly the same - just change the import path.

## Examples

### Basic File Storage
```typescript
const db = new SqliteOAuthDb({ db: './data/oauth.db' });
```

### In-Memory Database (Testing)
```typescript
const db = new SqliteOAuthDb({ db: ':memory:' });
```

### Custom Configuration
```typescript
const db = new SqliteOAuthDb({
  db: 'production-oauth.db',
  logger: customLogger,
  encrypt: encryptionFunction,
  decrypt: decryptionFunction
});
```

## License

MIT