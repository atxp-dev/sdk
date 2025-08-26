# ATXP SDK

The ATXP SDK provides a comprehensive solution for integrating ATXP (Authorization Token Exchange Protocol) functionality into your applications. It supports both client-side and server-side implementations with OAuth authentication and payment processing capabilities.

## Features

- **OAuth Authentication**: Full OAuth 2.0 flow support with PKCE
- **Payment Processing**: Integrated payment request handling
- **Multi-Platform Support**: Works with Node.js, React Native, and web environments
- **TypeScript Support**: Full TypeScript definitions included
- **Flexible Configuration**: Configurable for different deployment environments

## Installation

```bash
npm install @atxp/client
```

## Environment Variables

The ATXP SDK requires several environment variables to function properly:

### Required Environment Variables

#### `ATXP_AUTH_CLIENT_TOKEN`
**Required for server-side payment operations**

This token is used to authenticate with the ATXP authorization server for payment-related operations. It must be set when using the `ATXPPaymentServer` class.

```bash
ATXP_AUTH_CLIENT_TOKEN=your_auth_client_token_here
```

**Usage**: This token is automatically used in the `makeRequest` method of `ATXPPaymentServer` to authenticate API calls to the ATXP server.

#### `SOLANA_ENDPOINT`
**Required for Solana payment operations**

The RPC endpoint URL for the Solana network you want to use.

```bash
SOLANA_ENDPOINT=https://api.mainnet-beta.solana.com
```

#### `SOLANA_PRIVATE_KEY`
**Required for Solana payment operations**

The private key for the Solana account that will be used for payments.

```bash
SOLANA_PRIVATE_KEY=your_base58_encoded_private_key
```

### Optional Environment Variables

#### `NODE_ENV`
Controls the behavior of the SDK based on the environment.

```bash
NODE_ENV=development  # Enables development features like HTTP requests
NODE_ENV=production   # Enforces HTTPS and production security settings
```

#### `DEBUG`
Enables debug logging when set to any value.

```bash
DEBUG=1
```

## Quick Start

### Client-Side Usage

```typescript
import { atxpFetch } from '@atxp/client';
import { MemoryOAuthDb } from '@atxp/common';
// For persistent storage, install: npm install @atxp/sqlite
// import { SqliteOAuthDb } from '@atxp/sqlite';

const db = new MemoryOAuthDb(); // In-memory for development
// const db = new SqliteOAuthDb({ db: 'oauth.db' }); // For production

const fetchWithATXP = atxpFetch({
  accountId: 'user123',
  db,
  paymentMakers: {
    solana: {
      makePayment: async (payment) => {
        // Implement your payment logic here
        return 'payment-id';
      }
    }
  }
});

// Use the enhanced fetch function
const response = await fetchWithATXP('https://api.example.com/data');
```

### Server-Side Usage

```typescript
import { atxpServer } from '@atxp/server';
import { MemoryOAuthDb } from '@atxp/common';
// For persistent storage, install: npm install @atxp/sqlite
// import { SqliteOAuthDb } from '@atxp/sqlite';

const db = new MemoryOAuthDb(); // In-memory for development
// const db = new SqliteOAuthDb({ db: 'oauth.db' }); // For production

const app = express();
app.use('/atxp', atxpServer({
  destination: 'your-solana-destination-address',
  oAuthDb: db
}));
```

## Examples

See the `examples/` directory for complete working examples:

- `examples/basic/` - Basic client and server setup
- `examples/vercel-sdk/` - Vercel deployment example
- `examples/mastra/` - Mastra integration example

## API Reference

### Core Classes

- `ATXPFetcher` - Client-side fetch wrapper with OAuth and payment support
- `ATXPServer` - Server-side middleware for ATXP functionality
- `ATXPPaymentServer` - Payment processing server implementation
- `OAuthClient` - OAuth 2.0 client implementation
- `OAuthResourceClient` - Base OAuth resource client

### Configuration

All classes support extensive configuration options. See the TypeScript definitions for complete API documentation.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build the project
npm run build

# Run linting
npm run lint

# Run package manager integration tests (prevents crypto regressions)
npm run test:package-managers
```

## Integration Testing

The ATXP SDK includes comprehensive integration tests to ensure compatibility across different package managers and prevent crypto module loading regressions.

### Package Manager Compatibility Tests

These tests verify that the crypto functionality works correctly when the packages are consumed using different package managers:

```bash
# Test with all available package managers (npm, pnpm, yarn, bun)
npm run test:package-managers

# Test crypto functionality specifically
npm run test:integration
```

**What gets tested:**
- ✅ Crypto module loading across npm, pnpm, yarn, and bun
- ✅ UUID generation (`crypto.randomUUID()`)
- ✅ SHA-256 hashing (`crypto.digest()`)
- ✅ Hex encoding (`crypto.toHex()`)
- ✅ Environment detection (Node.js, browser, React Native)
- ✅ Cross-platform compatibility (Linux, macOS, Windows)

These tests run automatically in CI/CD and help prevent regressions like the "Cannot find module 'crypto'" error that can occur with certain package managers.

For detailed information, see [Package Manager Testing Documentation](./docs/PACKAGE_MANAGER_TESTING.md).

## License

MIT License - see LICENSE file for details.
