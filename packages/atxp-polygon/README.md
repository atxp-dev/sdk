# @atxp/polygon

ATXP for Polygon - Enable seamless payments in Polygon applications with direct wallet support.

## Overview

`@atxp/polygon` provides a complete solution for integrating ATXP (Autonomous Transaction eXecution Protocol) payments into Polygon applications. It handles Polygon-specific wallet interactions and USDC transfers while abstracting away the complexity of blockchain transactions.

**Note:** Smart Wallet mode is not supported on Polygon. Coinbase CDP does not provide Paymaster services for Polygon mainnet, which means gasless transactions via account abstraction are not available. All transactions require users to sign with their wallet and pay gas fees in POL.

The package supports two account types:

### Browser-Based Accounts (`PolygonBrowserAccount`)
- **Direct Wallet Mode** (`DirectWalletPaymentMaker`): Direct wallet integration where users sign each transaction and pay gas fees in POL

### Server/CLI Accounts (`PolygonServerAccount`)
- **Server Mode** (`ServerPaymentMaker`): For backend services and CLI tools using private keys directly

## Support

For detailed API documentation, configuration options, and advanced usage patterns, please refer to our [complete documentation](https://docs.atxp.ai/).

Have questions or need help? Join our [Discord community](https://discord.gg/FuJXHhe9aW) - we're happy to help!

## Installation

```bash
npm install @atxp/polygon
```

### Peer Dependencies

```bash
npm install viem
```

## Quick Start

### Browser Usage

```typescript
import { PolygonBrowserAccount } from '@atxp/polygon';

const account = await PolygonBrowserAccount.initialize({
  provider: window.ethereum, // or any EIP-1193 provider
  walletAddress: '0x1234...', // User's wallet address

  // Optional configuration
  customRpcUrl: 'https://polygon-rpc.com', // Custom RPC endpoint
  logger: console // Logger instance
});
```

### Server/CLI Usage

```typescript
import { PolygonServerAccount } from '@atxp/polygon';

const account = new PolygonServerAccount(
  'https://polygon-rpc.com',     // RPC URL
  '0x_your_private_key',         // Private key
  137                             // Chain ID (137 = Polygon mainnet)
);
```

### 2. Set up ATXP Client

```typescript
import { atxpClient } from '@atxp/client';

const client = await atxpClient({
  account,
  mcpServer: 'https://your-mcp-server.com',
  onPayment: async ({ payment }) => {
    console.log('Payment successful:', payment);
  },
  onPaymentFailure: async ({ payment, error }) => {
    console.error('Payment failed:', payment, error);
  }
});
```

### 3. Make MCP Tool Calls

```typescript
const result = await client.callTool({
  name: 'your_tool_name',
  arguments: { prompt: 'Generate an image' }
});
```

## React Integration Example

Here's how to integrate ATXP Polygon into a React application:

```typescript
import { PolygonBrowserAccount } from '@atxp/polygon';
import { atxpClient } from '@atxp/client';
import { useCallback, useEffect, useState } from 'react';

export const AtxpProvider = ({ children }) => {
  const [atxpAccount, setAtxpAccount] = useState<PolygonBrowserAccount | null>(null);
  const [client, setClient] = useState(null);

  const loadAccount = useCallback(async (walletAddress: string) => {
    const account = await PolygonBrowserAccount.initialize({
      provider: window.ethereum,
      walletAddress
    });
    setAtxpAccount(account);

    const atxpClient = await atxpClient({
      account,
      mcpServer: 'https://your-mcp-server.com',
      onPayment: async ({ payment }) => {
        console.log('Payment successful:', payment);
      }
    });
    setClient(atxpClient);
  }, []);

  // Initialize when wallet connects
  useEffect(() => {
    if (walletAddress && !atxpAccount) {
      loadAccount(walletAddress);
    }
  }, [walletAddress, atxpAccount, loadAccount]);

  const callMcpTool = useCallback(async (name: string, args: any) => {
    if (!client) return null;

    const response = await client.callTool({
      name,
      arguments: args
    });

    return response;
  }, [client]);

  return (
    <AtxpContext.Provider value={{ atxpAccount, callMcpTool }}>
      {children}
    </AtxpContext.Provider>
  );
};
```

## API Reference

### `PolygonBrowserAccount.initialize(options)`

Creates and initializes a browser-based Polygon account with direct wallet support.

#### Parameters

- `provider: Eip1193Provider` - EIP-1193 compatible provider (e.g., window.ethereum)
- `walletAddress: string` - The user's wallet address
- `customRpcUrl?: string` - Optional custom RPC URL (defaults to public Polygon RPC)
- `chainId?: number` - Chain ID (137 for mainnet, 80002 for Amoy testnet)
- `logger?: Logger` - Optional logger for debugging

**Deprecated parameters:** `useEphemeralWallet`, `allowance`, `periodInDays`, `periodStart`, and `coinbaseCdpApiKey` are no longer supported as Smart Wallet mode is not available on Polygon.

#### Returns

`Promise<PolygonBrowserAccount>` - Initialized browser Polygon account

### `PolygonServerAccount`

Server-side/CLI account for backend services.

#### Constructor

```typescript
new PolygonServerAccount(
  rpcUrl: string,
  privateKey: string,
  chainId: number = 137
)
```

#### Key Features

- Direct private key signing (no browser required)
- ES256K JWT authentication
- Simple USDC transfers
- Works in Node.js, CLI tools, and backend services

### `PolygonBrowserAccount`

Browser-based account class that handles Polygon wallet interactions.

#### Key Methods

- `getSources(): Promise<Source[]>` - Get wallet addresses and their sources
- Payment makers handle the actual payment processing

#### Key Features

- **USDC Transfers**: Handles native USDC transfers on Polygon (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)
- **Message Signing**: Signs JWTs using standard Ethereum message signing with special handling for Coinbase Wallet
- **Transaction Confirmation**: Tracks and confirms transaction status on-chain

### `DirectWalletPaymentMaker`

Browser-based payment maker for direct wallet signing.

#### Features

- Direct wallet signing for each transaction
- Support for Coinbase Wallet and standard wallets
- Transaction confirmation tracking
- Flexible message signing for different wallet providers
- Users pay gas fees in POL
- **Best for**: All Polygon browser applications

### `ServerPaymentMaker`

Server-side payment maker using direct private key signing.

#### Features

- ES256K JWT generation
- Direct USDC ERC-20 transfers
- Balance checking
- Transaction confirmation
- **Best for**: Backend services, CLI tools, testing

## Configuration

### Default Configuration

The package comes with sensible defaults:

- **Chain**: Polygon Mainnet (Chain ID: 137)
- **RPC**: Public Polygon RPC endpoint (https://polygon-rpc.com)
- **USDC Address**: Native USDC on Polygon (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)

### Direct Wallet Mode (Browser)

```typescript
const account = await PolygonBrowserAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...'
});
```

**How it works:**
1. Each transaction requires user approval in their wallet
2. JWT signing also requires user approval
3. Direct USDC transfers from user's wallet
4. User pays gas fees in POL

This is the only supported mode for Polygon browser applications.

### Server/CLI Mode

```typescript
import { PolygonServerAccount } from '@atxp/polygon';

const account = new PolygonServerAccount(
  'https://polygon-rpc.com',     // RPC URL
  '0x_your_private_key',         // Private key
  137                             // 137 = Polygon mainnet, 80002 = Amoy testnet
);
```

**How it works:**
1. Direct private key signing (no browser or wallet provider needed)
2. ES256K JWT authentication
3. Simple USDC ERC-20 transfers
4. Account pays gas fees in POL

**When to use:**
- Backend services and APIs
- CLI tools and scripts
- Testing and automation
- Server-side payment processing

### Custom RPC Endpoint

#### Browser

```typescript
const account = await PolygonBrowserAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...',
  customRpcUrl: 'https://your-polygon-rpc.com'
});
```

#### Server/CLI

```typescript
const account = new PolygonServerAccount(
  'https://your-polygon-rpc.com',  // Custom RPC
  '0x_your_private_key',
  137
);
```

## Error Handling

The library provides detailed error handling for common scenarios:

### Insufficient Balance

```typescript
try {
  await client.callTool({ name: 'expensive_tool', arguments: {} });
} catch (error) {
  if (error.message.includes('insufficient funds') ||
      error.message.includes('transfer amount exceeds balance')) {
    // Handle insufficient USDC balance
    console.log('Please add USDC to your wallet');
  }
}
```

### Transaction Failures

```typescript
const client = await atxpClient({
  account,
  mcpServer: 'https://your-server.com',
  onPaymentFailure: async ({ payment, error }) => {
    if (error.message.includes('Transaction receipt')) {
      // Payment verification failed - transaction may still be pending
      console.log('Payment verification failed, please wait and try again');
    } else if (error.message.includes('User rejected')) {
      // User rejected the transaction in their wallet
      console.log('Transaction was cancelled');
    }
  }
});
```

### Wallet Connection Errors

```typescript
try {
  const account = await PolygonBrowserAccount.initialize({
    provider: window.ethereum,
    walletAddress: '0x1234...'
  });
} catch (error) {
  if (error.message.includes('User rejected')) {
    // User rejected the wallet connection
    console.log('Please connect your wallet to continue');
  }
}
```

## Supported Networks

- **Polygon Mainnet** (Chain ID: 137) - Production
- **Polygon Amoy** (Chain ID: 80002) - Testnet

## Requirements

### Browser Usage
- Modern browser environment
- EIP-1193 compatible wallet provider (e.g., MetaMask, Coinbase Wallet, WalletConnect)
- USDC balance on Polygon
- POL balance for gas fees

### Server/CLI Usage
- Node.js 16+
- Private key with USDC and POL balance

## Technical Details

### Authentication

- **Direct Wallet Mode** (`DirectWalletPaymentMaker`): Uses standard Ethereum message signing with special handling for Coinbase Wallet
- **Server Mode** (`ServerPaymentMaker`): Uses ES256K JWT with direct private key signing

### Why No Smart Wallet Support?

Coinbase CDP does not provide Paymaster services for Polygon mainnet, which means:
- Gasless transactions via account abstraction are not available
- ERC-4337 smart wallet operations would require users to pay gas fees
- This eliminates the primary benefit of using smart wallets

For the best user experience on Polygon, use Direct Wallet mode where users sign transactions directly with their wallet.

## License

See the main ATXP SDK repository for license information.
