# @atxp/redis-db

ATXP Redis Database - Redis OAuth database implementation for Authorization Token Exchange Protocol.

## Overview

The ATXP Redis Database package provides distributed OAuth token storage using Redis. It's designed for scalable applications that need shared token storage across multiple server instances or require high-performance, in-memory token caching.

## Features

- ⚡ **High Performance**: In-memory Redis storage for fast token operations
- 🔄 **Distributed**: Share tokens across multiple application instances  
- 🔐 **Encryption Support**: Optional encryption for sensitive token data
- ⏰ **TTL Support**: Automatic token expiration and cleanup
- 🗝️ **Key Prefixing**: Namespace isolation for multi-tenant applications
- 🛡️ **Type Safety**: Full TypeScript support

## Installation

```bash
npm install @atxp/redis-db
```

### Prerequisites

- Redis server running and accessible
- Node.js application (Redis is not available in browser environments)

## Basic Usage

```typescript
import { RedisOAuthDb } from '@atxp/redis-db';

// Create database instance with Redis URL
const db = new RedisOAuthDb({
  redis: 'redis://localhost:6379'
});

// Use with ATXP client
import { ATXPClient } from '@atxp/client';

const client = new ATXPClient({
  serverUrl: 'http://localhost:3010',
  clientId: 'your-oauth-client-id',
  oAuthDb: db  // Use Redis storage
});
```

## Configuration Options

```typescript
interface RedisOAuthDbConfig {
  redis: RedisClient | string;           // Redis client instance or connection URL
  encrypt?: (data: string) => string;    // Optional encryption function
  decrypt?: (data: string) => string;    // Optional decryption function
  logger?: Logger;                       // Optional custom logger
  keyPrefix?: string;                    // Key prefix for namespacing (default: 'oauth:')
  ttl?: number;                         // Default TTL in seconds for tokens
}
```

## Advanced Configuration

### Custom Redis Client
```typescript
import Redis from 'ioredis';
import { RedisOAuthDb } from '@atxp/redis-db';

const redis = new Redis({
  host: 'redis.example.com',
  port: 6379,
  password: 'your-redis-password',
  db: 0,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

const db = new RedisOAuthDb({
  redis,
  keyPrefix: 'myapp:oauth:',
  ttl: 3600  // 1 hour default TTL
});
```

### Encryption Support
```typescript
import { RedisOAuthDb } from '@atxp/redis-db';

const db = new RedisOAuthDb({
  redis: process.env.REDIS_URL,
  keyPrefix: 'secure:oauth:',
  encrypt: (data: string) => {
    // Implement your encryption logic
    return Buffer.from(data).toString('base64');
  },
  decrypt: (data: string) => {
    // Implement your decryption logic  
    return Buffer.from(data, 'base64').toString();
  }
});
```

## Redis Key Structure

The package uses the following Redis key patterns:

- **Client Credentials**: `{prefix}client_credentials:{resource_url}`
- **PKCE Values**: `{prefix}pkce:{user_id}:{state}`  
- **Access Tokens**: `{prefix}access_token:{user_id}:{url}`

Example with default prefix:
```
oauth:client_credentials:https://api.example.com
oauth:pkce:user123:abc123state
oauth:access_token:user123:https://api.example.com
```

## TTL (Time To Live) Behavior

### Automatic Expiration
- **PKCE Values**: Fixed 10-minute TTL for security
- **Access Tokens**: Uses token's `expires_at` or configured default TTL
- **Client Credentials**: No expiration by default

### Custom TTL Configuration
```typescript
const db = new RedisOAuthDb({
  redis: redisUrl,
  ttl: 7200  // 2 hours default for access tokens
});
```

## Environment Variables

Common environment variables for Redis configuration:

```bash
# Redis connection
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_DB=0

# Optional Redis SSL/TLS
REDIS_TLS=true
```

## Integration Tests

The package includes integration tests that require a running Redis instance:

```bash
# Start Redis (using Docker)
docker run -d --name redis-test -p 6379:6379 redis:latest

# Run integration tests
REDIS_URL=redis://localhost:6379 npm run test:integration
```

## Migration from @atxp/common

If you were previously using `MemoryOAuthDb` and want to upgrade to Redis:

```typescript
// Old (in-memory, single instance)
import { MemoryOAuthDb } from '@atxp/common';
const db = new MemoryOAuthDb();

// New (distributed Redis storage)  
import { RedisOAuthDb } from '@atxp/redis-db';
const db = new RedisOAuthDb({
  redis: process.env.REDIS_URL || 'redis://localhost:6379'
});
```

## Production Considerations

### High Availability
```typescript
import Redis from 'ioredis';

const redis = new Redis.Cluster([
  { host: 'redis1.example.com', port: 6379 },
  { host: 'redis2.example.com', port: 6379 },
  { host: 'redis3.example.com', port: 6379 },
]);

const db = new RedisOAuthDb({ redis });
```

### Connection Monitoring
```typescript
const db = new RedisOAuthDb({
  redis: redisUrl,
  logger: productionLogger  // Log connection issues
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await db.close();
});
```

## Performance

Redis provides excellent performance characteristics:
- **Sub-millisecond** token retrieval times
- **Horizontal scaling** via Redis Cluster
- **Memory efficiency** with automatic expiration
- **Network optimization** via connection pooling

## Troubleshooting

### Connection Issues
```typescript
try {
  const db = new RedisOAuthDb({ redis: redisUrl });
  // Test connection
  await db.getClientCredentials('test-url');
} catch (error) {
  console.error('Redis connection failed:', error);
}
```

### Key Debugging
Enable Redis monitoring to see key operations:
```bash
redis-cli monitor
```

## License

MIT