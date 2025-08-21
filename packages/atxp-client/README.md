# @atxp/client

ATXP Client - MCP client with OAuth authentication and payment processing capabilities.

## Overview

The ATXP Client package provides a comprehensive solution for connecting to MCP (Model Context Protocol) servers that require OAuth authentication and payment processing. It handles the complete flow from initial connection through authentication, payment verification, and tool execution.

**🚀 Getting Started**: Learn more about ATXP in [the docs](https://docs.atxp.ai/atxp), and follow the [Agent Quickstart](https://docs.atxp.ai/client) to build your first ATXP-powered agent.

## Features

- 🔐 **OAuth Authentication**: Full OAuth 2.0 flow implementation
- 💰 **Payment Processing**: Solana-based payment integration  
- 🔌 **MCP Protocol**: Complete Model Context Protocol client implementation
- 📱 **Multi-Platform**: Supports Node.js and React Native/Expo environments
- 🛡️ **Type Safety**: Full TypeScript support with comprehensive type definitions
- 🔄 **Event System**: Real-time connection and authentication status updates

## Installation

```bash
npm install @atxp/client
```

## Basic Usage

```typescript
import { ATXPClient } from '@atxp/client';

const client = new ATXPClient({
  serverUrl: 'http://localhost:3010',
  clientId: 'your-oauth-client-id',
  authServerUrl: 'https://auth.atxp.ai'
});

// Connect and authenticate
await client.connect();

// Call tools that require payment
const result = await client.callTool('hello_world', {
  name: 'Alice',
  message: 'Hello from ATXP!'
});
```

## Platform Support

- **Node.js**: Full support with in-memory OAuth database (install `@atxp/sqlite-db` for persistence)
- **React Native/Expo**: Requires `expo-crypto` peer dependency

## Authentication Flow

1. Client initiates connection to MCP server
2. Server responds with OAuth challenge
3. Client redirects user to authentication server
4. User completes OAuth flow and returns with authorization code
5. Client exchanges code for access token
6. Authenticated requests can now be made to the server

## Payment Processing

When a tool requires payment, the client automatically:

1. Detects payment requirement from server response
2. Creates Solana payment transaction
3. Prompts user to approve payment
4. Submits payment proof to server
5. Retries original tool call upon payment confirmation

## API Reference

### ATXPClient

Main client class for ATXP protocol communication.

#### Constructor Options

```typescript
interface ATXPClientConfig {
  serverUrl: string;           // MCP server URL
  clientId: string;            // OAuth client ID  
  authServerUrl?: string;      // Auth server URL (defaults to https://auth.atxp.ai)
  oAuthDb?: OAuthDb;          // Custom OAuth database implementation
}
```

#### Methods

- `connect()`: Establish connection to MCP server
- `disconnect()`: Close connection and cleanup resources
- `callTool(name, args)`: Execute server tool with automatic auth/payment handling
- `listTools()`: Get available tools from server
- `getAuthStatus()`: Check current authentication status

#### Events

- `authenticated`: Fired when OAuth flow completes successfully
- `paymentRequired`: Fired when tool execution requires payment
- `paymentCompleted`: Fired when payment is confirmed
- `error`: Fired on connection or protocol errors

## Examples

See the `examples/` directory for complete working examples:

- `examples/basic/`: Simple Node.js client implementation
- `examples/server/`: Compatible MCP server with payment requirements

## License

MIT