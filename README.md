# ATXP

ATXP is a framework for building and running agents that can interact with the world. See [docs.atxp.ai](https://docs.atxp.ai) for documentation and examples.

## Features

- **OAuth 2.0 Authentication**: Secure authentication flow for accessing protected resources
- **Micropayments**: Built-in support for USDC payments on Base and Solana networks
- **MCP Integration**: Full Model Context Protocol support for AI agents
- **X402 Protocol Support**: Compatible with X402 payment-required servers
- **Multi-Network**: Support for Base, Solana, and ATXP native accounts

## X402 Support

ATXP SDK now includes support for the X402 payment protocol, allowing ATXP clients to interact with X402 servers seamlessly. This enables:

- Automatic handling of HTTP 402 payment challenges
- Signed payment message creation without immediate blockchain submission
- Facilitator-based payment verification and settlement

For detailed X402 integration instructions, see [X402 Integration Guide](./docs/x402-integration.md) and the [X402 example](./examples/x402-server).

## Quick Start

### Basic ATXP Client

```typescript
import { atxpClient, BaseAccount } from '@atxp/client';

const account = new BaseAccount(rpcUrl, privateKey);
const client = await atxpClient({ account, /* ... */ });
```

### With X402 Support

```typescript
import { wrapWithX402 } from '@atxp/client';

const x402Fetch = wrapWithX402(fetch, {
  account,
  approvePayment: async (payment) => true,
  // ... configuration
});
```

## Documentation

- [ATXP Documentation](https://docs.atxp.ai)
- [X402 Integration Guide](./docs/x402-integration.md)
- [API Reference](https://docs.atxp.ai/api)

## Examples

- [Basic ATXP Example](./examples/basic)
- [X402 Server Example](./examples/x402-server)
- [Server Example](./examples/server)
- [Vercel SDK Integration](./examples/vercel-sdk)