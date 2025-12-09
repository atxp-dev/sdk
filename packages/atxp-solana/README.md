# ATXP Solana

ATXP is a framework for building and running agents that can interact with the world. See [docs.atxp.ai](https://docs.atxp.ai) for documentation and examples.

ATXP Solana provides Solana blockchain support for `@atxp/client`, enabling payments and authentication using Solana wallets.

## Support

For detailed API documentation, configuration options, and advanced usage patterns, please refer to our [complete documentation](https://docs.atxp.ai/).

Have questions or need help? Join our [Discord community](https://discord.gg/FuJXHhe9aW) - we're happy to help!

## Installation

```bash
npm install @atxp/solana @solana/web3.js @solana/pay bs58
```

## Usage

```typescript
import { SolanaAccount } from '@atxp/solana';
import { atxpClient } from '@atxp/client';
import { Keypair } from '@solana/web3.js';

// Create or load a Solana keypair
const keypair = Keypair.generate();

// Create a Solana account
const account = new SolanaAccount({
  keypair,
  solanaRpcUrl: 'https://api.mainnet-beta.solana.com'
});

// Use with atxpClient
const client = await atxpClient({
  account,
  mcpServer: 'https://browse.mcp.atxp.ai/'
});

const res = await client.callTool({
  name: 'atxp_browse',
  arguments: { query: 'What is Solana?' }
});
```

## SolanaAccount

The `SolanaAccount` class provides Solana wallet integration for ATXP:

- **Authentication**: Signs JWTs using Solana keypair for MCP server authentication
- **Payments**: Makes USDC payments on Solana using SPL tokens
- **Wallet Integration**: Works with any Solana wallet that provides a `Keypair`

### Configuration

```typescript
const account = new SolanaAccount({
  keypair: Keypair,           // Your Solana keypair
  solanaRpcUrl: string,       // Solana RPC endpoint
  logger?: Logger             // Optional logger instance
});
```

## SolanaPaymentMaker

The `SolanaPaymentMaker` class handles USDC payments on Solana:

- Uses `@solana/pay` for payment transactions
- Supports USDC SPL token transfers
- Validates transactions before and after sending

You generally don't need to use this directly - `SolanaAccount` uses it internally.
