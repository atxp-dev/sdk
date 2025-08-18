# @atxp/server

ATXP Server - MCP server implementation with payment processing capabilities.

## Overview

The ATXP Server package provides middleware and utilities for creating MCP (Model Context Protocol) servers that require OAuth authentication and payment processing. It integrates seamlessly with Express.js applications to add payment requirements to any MCP tool.

**🚀 Getting Started**: Learn more about ATXP in [the docs](https://docs.atxp.ai/atxp), and follow the [MCP Server Quickstart](https://docs.atxp.ai/server) to build your first monetized MCP server using ATXP.

## Features

- 🔐 **OAuth Integration**: Complete OAuth 2.0 server middleware
- 💰 **Payment Validation**: Solana payment verification and processing
- 🛠️ **MCP Protocol**: Full Model Context Protocol server implementation
- 🚀 **Express Middleware**: Easy integration with existing Express applications
- 🔄 **Challenge System**: Automatic authentication challenges for unauthorized requests
- 📊 **Payment Tracking**: Built-in payment confirmation and tracking

## Installation

```bash
npm install @atxp/server
```

## Basic Usage

```typescript
import express from 'express';
import { ATXPServer, requirePayment } from '@atxp/server';

const app = express();
const server = new ATXPServer({
  clientId: 'your-oauth-client-id',
  authServerUrl: 'https://auth.atxp.ai',
  destinationAddress: 'your-solana-wallet-address'
});

// Add MCP tools with payment requirements
server.addTool({
  name: 'hello_world',
  description: 'A simple greeting tool',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' }
    }
  }
}, requirePayment('0.01'), async ({ name }) => {
  return `Hello, ${name || 'World'}!`;
});

// Mount server middleware
app.use('/', server.middleware());
app.listen(3010);
```

## Authentication & Payment Flow

1. **Unauthenticated Request**: Client sends MCP request without auth token
2. **OAuth Challenge**: Server responds with OAuth challenge and redirect URL
3. **Client Authentication**: Client completes OAuth flow and obtains access token  
4. **Authenticated Request**: Client retries request with valid access token
5. **Payment Required**: Server responds with payment requirement (amount, destination)
6. **Payment Processing**: Client makes Solana payment to specified address
7. **Payment Verification**: Server confirms payment on-chain
8. **Tool Execution**: Server executes requested tool and returns results

## API Reference

### ATXPServer

Main server class for handling ATXP protocol requests.

#### Constructor Options

```typescript
interface ATXPServerConfig {
  clientId: string;            // OAuth client ID
  authServerUrl?: string;      // Auth server URL (defaults to https://auth.atxp.ai)
  destinationAddress: string;  // Solana wallet address for payments
  oAuthDb?: OAuthDb;          // Custom OAuth database implementation
}
```

#### Methods

- `addTool(definition, middleware, handler)`: Register MCP tool with payment requirements
- `middleware()`: Get Express middleware function
- `handleMCPRequest(req, res)`: Process MCP protocol requests

### requirePayment(amount)

Middleware function that adds payment requirements to tools.

```typescript
const paymentMiddleware = requirePayment('0.01'); // 0.01 SOL/USDC
```

### Payment Verification

The server automatically handles:
- On-chain payment confirmation
- Payment amount validation  
- Duplicate payment prevention
- Transaction signature verification

## Tool Registration

Tools can be registered with various middleware combinations:

```typescript
// Free tool (no payment required)
server.addTool(toolDef, async (args) => {
  return 'Free result';
});

// Paid tool with fixed amount
server.addTool(toolDef, requirePayment('0.01'), async (args) => {
  return 'Paid result';
});

// Custom middleware chain
server.addTool(toolDef, 
  requirePayment('0.05'),
  customValidation,
  async (args) => {
    return 'Premium result';
  }
);
```

## Error Handling

The server provides structured error responses for:
- Authentication failures
- Payment requirement notifications
- Payment verification failures
- Tool execution errors
- Invalid MCP requests

## Examples

See the `examples/server/` directory for a complete working server implementation.

## License

MIT