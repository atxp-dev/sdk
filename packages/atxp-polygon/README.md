# @atxp/polygon

ATXP for Polygon - Enable seamless payments in Polygon applications with smart wallet and direct wallet support.

## Overview

`@atxp/polygon` provides a complete solution for integrating ATXP (Autonomous Transaction eXecution Protocol) payments into Polygon applications. It handles Polygon-specific wallet interactions, USDC transfers, and smart wallet integration while abstracting away the complexity of blockchain transactions.

The package supports three account types:

### Browser-Based Accounts (`PolygonBrowserAccount`)
- **Smart Wallet Mode** (`SmartWalletPaymentMaker`): Uses Coinbase CDP for ephemeral smart wallets with account abstraction and gasless transactions (default, best UX)
- **Direct Wallet Mode** (`DirectWalletPaymentMaker`): Direct wallet integration where users sign each transaction

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

#### Option 1: Smart Wallet Mode (Recommended - Best UX)

```typescript
import { PolygonBrowserAccount } from '@atxp/polygon';

const account = await PolygonBrowserAccount.initialize({
  provider: window.ethereum, // or any EIP-1193 provider
  walletAddress: '0x1234...', // User's wallet address
  useEphemeralWallet: true, // Smart wallet with gasless transactions

  // Spend permission parameters
  allowance: BigInt('10000000'), // 10 USDC (in 6 decimals)
  periodInDays: 30, // Permission valid for 30 days
  periodStart: Math.floor(Date.now() / 1000), // Start time in seconds

  // Optional configuration
  customRpcUrl: 'https://polygon-rpc.com', // Custom RPC endpoint
  logger: console // Logger instance
});
```

#### Option 2: Direct Wallet Mode

```typescript
import { PolygonBrowserAccount } from '@atxp/polygon';

const account = await PolygonBrowserAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...',
  useEphemeralWallet: false, // User signs each transaction
  allowance: BigInt('10000000'),
  periodInDays: 30,
  periodStart: Math.floor(Date.now() / 1000)
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
      walletAddress,
      useEphemeralWallet: true,
      allowance: BigInt('10000000'), // 10 USDC
      periodInDays: 30,
      periodStart: Math.floor(Date.now() / 1000)
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

Creates and initializes a browser-based Polygon account with smart wallet or direct wallet support.

#### Parameters

- `provider: Eip1193Provider` - EIP-1193 compatible provider (e.g., window.ethereum)
- `walletAddress: string` - The user's wallet address
- `useEphemeralWallet?: boolean` - Whether to use smart wallet (true) or direct wallet (false). Default: true
- `allowance: bigint` - Maximum USDC amount that can be spent (in 6 decimals)
- `periodInDays: number` - Permission validity period in days
- `periodStart: number` - Permission start time in Unix seconds
- `customRpcUrl?: string` - Optional custom RPC URL (defaults to public Polygon RPC)
- `chainId?: number` - Chain ID (137 for mainnet, 80002 for Amoy testnet)
- `logger?: Logger` - Optional logger for debugging

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
- **Message Signing**: Signs JWTs using EIP-1271 for smart wallets or standard signing for direct wallets
- **Smart Wallet Integration**: Uses Coinbase CDP for account abstraction and gasless transactions
- **Spend Permissions**: Manages recurring payment permissions with ERC-20 approvals
- **Automatic Deployment**: Deploys smart wallet before first use (smart wallet mode only)

### `SmartWalletPaymentMaker`

Browser-based payment maker using ephemeral smart wallets with account abstraction.

#### Features

- Gasless transactions via Coinbase CDP bundler
- Batched transaction support
- Automatic memo appending to transfers
- User operation handling
- **Best for**: Production browser apps (best UX)

### `DirectWalletPaymentMaker`

Browser-based payment maker for direct wallet signing.

#### Features

- Direct wallet signing for each transaction
- Support for Coinbase Wallet and standard wallets
- Transaction confirmation tracking
- Flexible message signing for different wallet providers
- **Best for**: Users who want full control, compatibility mode

### `ServerPaymentMaker`

Server-side payment maker using direct private key signing.

#### Features

- ES256K JWT generation
- Direct USDC ERC-20 transfers
- Balance checking
- Transaction confirmation
- **Best for**: Backend services, CLI tools, testing

### Caching System

```typescript
import { IntermediaryCache } from '@atxp/polygon';

// Browser-based cache for persistent permission storage
const cache = new IntermediaryCache();

// Store permission
await cache.set('cache-key', {
  privateKey: '0x...',
  permission: { /* spend permission data */ }
});

// Retrieve permission
const intermediary = await cache.get('cache-key');
```

## Configuration

### Default Configuration

The package comes with sensible defaults:

- **Chain**: Polygon Mainnet (Chain ID: 137)
- **RPC**: Public Polygon RPC endpoint (https://polygon-rpc.com)
- **USDC Address**: Native USDC on Polygon (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)
- **Bundler**: Coinbase CDP Polygon bundler
- **Paymaster**: Coinbase CDP paymaster (gasless transactions)

### Smart Wallet Mode (Browser - Default, Recommended)

```typescript
const account = await PolygonBrowserAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...',
  useEphemeralWallet: true, // default - uses SmartWalletPaymentMaker
  allowance: BigInt('10000000'),
  periodInDays: 30,
  periodStart: Math.floor(Date.now() / 1000)
});
```

**How it works:**
1. Creates a new ephemeral smart wallet using Coinbase CDP
2. Requests ERC-20 approval for the smart wallet to spend USDC
3. Deploys the smart wallet on first use
4. Stores permission and wallet in cache for subsequent use
5. All transactions are gasless via Coinbase paymaster

**Benefits:**
- Single approval for multiple transactions
- Gasless transactions (no native POL needed)
- Improved UX with minimal user prompts

### Direct Wallet Mode (Browser)

```typescript
const account = await PolygonBrowserAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...',
  useEphemeralWallet: false, // uses DirectWalletPaymentMaker
  allowance: BigInt('10000000'),
  periodInDays: 30,
  periodStart: Math.floor(Date.now() / 1000)
});
```

**How it works:**
1. Each transaction requires user approval in their wallet
2. JWT signing also requires user approval
3. Direct USDC transfers from user's wallet
4. User pays gas fees in POL

**When to use:**
- Users want full control over each transaction
- Development/testing environments
- Compatibility with wallets that don't support smart contracts

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
  customRpcUrl: 'https://your-polygon-rpc.com',
  useEphemeralWallet: true,
  allowance: BigInt('10000000'),
  periodInDays: 30,
  periodStart: Math.floor(Date.now() / 1000)
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

### Approval/Permission Errors

```typescript
try {
  const account = await PolygonAccount.initialize({
    provider: window.ethereum,
    walletAddress: '0x1234...',
    useEphemeralWallet: true,
    allowance: BigInt('10000000'),
    periodInDays: 30,
    periodStart: Math.floor(Date.now() / 1000)
  });
} catch (error) {
  if (error.message.includes('User rejected')) {
    // User rejected the ERC-20 approval
    console.log('Please approve USDC spending to continue');
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
- POL balance for gas fees (only in direct wallet mode; smart wallet mode is gasless)

### Server/CLI Usage
- Node.js 16+
- Private key with USDC and POL balance

## Technical Details

### Smart Wallet Architecture

The ephemeral wallet implementation uses:
- **Coinbase CDP SDK** for smart wallet creation and management
- **ERC-4337 Account Abstraction** for gasless transactions
- **Coinbase Bundler** for user operation submission
- **Coinbase Paymaster** for gas sponsorship

### Spend Permission System

Instead of native spend permissions (which Polygon doesn't support), this package uses:
- **ERC-20 Approve/TransferFrom** pattern for permission management
- **Approval caching** to avoid repeated approval requests
- **Permission parameters** stored in cache for validation

### Authentication

- **Smart Wallet Mode** (`SmartWalletPaymentMaker`): Uses EIP-1271 smart contract signature verification
- **Direct Wallet Mode** (`DirectWalletPaymentMaker`): Uses standard Ethereum message signing with special handling for Coinbase Wallet
- **Server Mode** (`ServerPaymentMaker`): Uses ES256K JWT with direct private key signing

## License

See the main ATXP SDK repository for license information.
