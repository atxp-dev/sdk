# @atxp/common

ATXP Core - Shared utilities and types for Authorization Token Exchange Protocol.

## Overview

The ATXP Common package provides shared utilities, types, and core functionality used by both ATXP client and server implementations. It contains the foundational components for OAuth authentication, JWT token handling, payment processing, and MCP protocol utilities.

**🚀 Getting Started**: Learn more about ATXP in [the docs](https://docs.atxp.ai/atxp).

## Features

- 🔐 **JWT Token Management**: Secure token creation, validation, and parsing
- 🗄️ **OAuth Database**: Abstract database interface with memory implementation
- 📡 **MCP JSON Utilities**: Type-safe MCP protocol message handling
- 💰 **Payment Error Handling**: Structured payment requirement error types
- 🛠️ **Platform Utilities**: Cross-platform compatibility helpers
- 📊 **SSE Parser**: Server-sent events parsing for real-time communication
- 🔧 **Logger**: Configurable logging system

## Installation

```bash
npm install @atxp/common
```

This package is typically installed automatically as a dependency of `@atxp/client` or `@atxp/server`.

## Key Components

### JWT Token Management

```typescript
import { createJWT, verifyJWT, parseJWT } from '@atxp/common';

// Create signed JWT
const token = await createJWT({ userId: '123' }, secretKey);

// Verify and parse JWT
const payload = await verifyJWT(token, secretKey);

// Parse without verification (for debugging)
const { header, payload } = parseJWT(token);
```

### OAuth Database Interface

```typescript
import { OAuthDb, MemoryOAuthDb } from '@atxp/common';

// Use in-memory database for development
const oAuthDb = new MemoryOAuthDb();

// Store OAuth tokens
await oAuthDb.storeTokens('client123', {
  access_token: 'token',
  refresh_token: 'refresh',
  expires_in: 3600
});

// Retrieve tokens
const tokens = await oAuthDb.getTokens('client123');
```

### MCP Protocol Utilities

```typescript
import { 
  MCPRequest, 
  MCPResponse, 
  MCPError,
  createMCPResponse,
  createMCPError 
} from '@atxp/common';

// Type-safe MCP request handling
function handleMCPRequest(request: MCPRequest): MCPResponse {
  if (request.method === 'tools/call') {
    return createMCPResponse(request.id, { result: 'success' });
  }
  return createMCPError(request.id, -32601, 'Method not found');
}
```

### Payment Error Handling

```typescript
import { PaymentRequiredError } from '@atxp/common';

// Throw structured payment requirement
throw new PaymentRequiredError({
  amount: '0.01',
  currency: 'USDC',
  destination: 'solana-wallet-address',
  reference: 'unique-payment-reference'
});
```

### Platform Utilities

```typescript
import { crypto, isNode, getIsReactNative } from '@atxp/common';

// Detect runtime environment
if (isNode) {
  // Node.js specific code - can use SQLite or Redis
} else if (getIsReactNative()) {
  // React Native/Expo - use MemoryOAuthDb
}

// Use platform-specific crypto
const hash = await crypto.digest(new TextEncoder().encode('data'));
const uuid = crypto.randomUUID();
```

## Type Definitions

The package exports comprehensive TypeScript types for:

- **OAuth Types**: Token responses, authorization flows, client configurations
- **MCP Types**: Protocol messages, tool definitions, error structures  
- **Payment Types**: Payment requirements, transaction references, currency info
- **Server Types**: Authentication contexts, middleware definitions

## Database Implementations

### MemoryOAuthDb

In-memory OAuth token storage for development and testing:

```typescript
import { MemoryOAuthDb } from '@atxp/common';

const db = new MemoryOAuthDb();
// Tokens stored in memory, cleared on process restart
```

### Additional Database Options

For production use cases requiring persistent storage, see separate database packages:

- **`@atxp/sqlite`**: SQLite implementation using `better-sqlite3` (Node.js only)
- **`@atxp/redis`**: Redis implementation using `ioredis` for distributed applications

```bash
npm install @atxp/sqlite  # For SQLite storage
npm install @atxp/redis   # For Redis storage
```

## Logging

Configurable logging system with multiple levels:

```typescript
import { Logger } from '@atxp/common';

const logger = new Logger('MyComponent');

logger.debug('Debug message');
logger.info('Info message'); 
logger.warn('Warning message');
logger.error('Error message');
```

## Utilities

Various utility functions for:
- Async operation helpers
- Data validation and sanitization
- Error handling and formatting
- Time and date operations

## Examples

This package is used internally by the client and server packages. See:
- `@atxp/client` for client-side usage examples
- `@atxp/server` for server-side usage examples

## License

MIT