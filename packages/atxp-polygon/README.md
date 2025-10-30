# @atxp/polygon

ATXP for Polygon - Enable seamless payments in Polygon applications with smart wallet and direct wallet support.

## Overview

`@atxp/polygon` provides a complete solution for integrating ATXP (Autonomous Transaction eXecution Protocol) payments into Polygon applications. It handles Polygon-specific wallet interactions, USDC transfers, and smart wallet integration while abstracting away the complexity of blockchain transactions.

The package supports two payment modes:
- **Ephemeral Wallet Mode**: Uses Coinbase CDP for smart wallet creation with account abstraction (default)
- **Main Wallet Mode**: Direct wallet integration for users who prefer to sign each transaction

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

### 1. Initialize a Polygon Account

```typescript
import { PolygonAccount } from '@atxp/polygon';

const account = await PolygonAccount.initialize({
  provider: window.ethereum, // or any EIP-1193 provider
  walletAddress: '0x1234...', // User's wallet address
  useEphemeralWallet: true, // true = ephemeral smart wallet, false = main wallet

  // Spend permission parameters
  allowance: BigInt('10000000'), // 10 USDC (in 6 decimals)
  periodInDays: 30, // Permission valid for 30 days
  periodStart: Math.floor(Date.now() / 1000), // Start time in seconds

  // Optional configuration
  customRpcUrl: 'https://polygon-rpc.com', // Custom RPC endpoint
  logger: console // Logger instance
});
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
import { PolygonAccount } from '@atxp/polygon';
import { atxpClient } from '@atxp/client';
import { useCallback, useEffect, useState } from 'react';

export const AtxpProvider = ({ children }) => {
  const [atxpAccount, setAtxpAccount] = useState<PolygonAccount | null>(null);
  const [client, setClient] = useState(null);

  const loadAccount = useCallback(async (walletAddress: string) => {
    const account = await PolygonAccount.initialize({
      provider: window.ethereum,
      walletAddress,
      useEphemeralWallet: true,
      allowance: BigInt('10000000'), // 10 USDC
      periodInDays: 30
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

### `PolygonAccount.initialize(options)`

Creates and initializes a Polygon account with smart wallet or main wallet support.

#### Parameters

- `provider: Eip1193Provider` - EIP-1193 compatible provider (e.g., window.ethereum)
- `walletAddress: string` - The user's wallet address
- `useEphemeralWallet?: boolean` - Whether to use ephemeral smart wallet (default: true)
- `allowance: bigint` - Maximum USDC amount that can be spent (in 6 decimals)
- `periodInDays: number` - Permission validity period in days
- `periodStart: number` - Permission start time in Unix seconds
- `customRpcUrl?: string` - Optional custom RPC URL (defaults to public Polygon RPC)
- `logger?: Logger` - Optional logger for debugging

#### Returns

`Promise<PolygonAccount>` - Initialized Polygon account

### `PolygonAccount`

The main account class that handles Polygon interactions.

#### Key Methods

- `getId(): Promise<AccountId>` - Get the account identifier for authentication
- `makePayments(payments: PaymentTransaction[]): Promise<PaymentReceipt[]>` - Process multiple payments

#### Key Features

- **USDC Transfers**: Handles native USDC transfers on Polygon (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)
- **Message Signing**: Signs JWTs using EIP-1271 for smart wallets or standard signing for main wallets
- **Smart Wallet Integration**: Uses Coinbase CDP for account abstraction and gasless transactions
- **Spend Permissions**: Manages recurring payment permissions with ERC-20 approvals
- **Automatic Deployment**: Deploys smart wallet before first use (ephemeral mode only)

### `PolygonPaymentMaker`

Handles payment processing using ephemeral smart wallets with account abstraction.

#### Features

- Gasless transactions via Coinbase CDP bundler
- Batched transaction support
- Automatic memo appending to transfers
- User operation handling

### `MainWalletPaymentMaker`

Alternative payment processor for direct wallet integrations.

#### Features

- Direct wallet signing for each transaction
- Support for Coinbase Wallet and standard wallets
- Transaction confirmation tracking
- Flexible message signing for different wallet providers

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

### Ephemeral Wallet Mode (Default)

```typescript
const account = await PolygonAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...',
  useEphemeralWallet: true, // default
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
- Gasless transactions (no native MATIC needed)
- Improved UX with minimal user prompts

### Main Wallet Mode

```typescript
const account = await PolygonAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...',
  useEphemeralWallet: false, // direct wallet mode
  allowance: BigInt('10000000'),
  periodInDays: 30,
  periodStart: Math.floor(Date.now() / 1000)
});
```

**How it works:**
1. Each transaction requires user approval in their wallet
2. JWT signing also requires user approval
3. Direct USDC transfers from user's wallet
4. User pays gas fees in MATIC

**When to use:**
- Users want full control over each transaction
- Development/testing environments
- Compatibility with wallets that don't support smart contracts

### Custom RPC Endpoint

```typescript
const account = await PolygonAccount.initialize({
  provider: window.ethereum,
  walletAddress: '0x1234...',
  customRpcUrl: 'https://your-polygon-rpc.com',
  useEphemeralWallet: true,
  allowance: BigInt('10000000'),
  periodInDays: 30,
  periodStart: Math.floor(Date.now() / 1000)
});
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

- **Polygon Mainnet** (Chain ID: 137)

## Requirements

- Node.js 16+ or modern browser environment
- EIP-1193 compatible wallet provider (e.g., MetaMask, Coinbase Wallet, WalletConnect)
- USDC balance on Polygon mainnet
- MATIC balance for gas fees (only in main wallet mode)

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

- **Ephemeral Wallet**: Uses EIP-1271 smart contract signature verification
- **Main Wallet**: Uses standard Ethereum message signing
- **Coinbase Wallet**: Special handling for hex-encoded message format

## Migration Guide

### From Base to Polygon

If you're migrating from `@atxp/base`:

```typescript
// Before (Base)
import { BaseAppAccount } from '@atxp/base';
const account = await BaseAppAccount.initialize({
  walletAddress: address,
  apiKey,
  appName: 'My App',
  useEphemeralWallet: true,
  allowance: BigInt('10000000'),
  periodInDays: 30
});

// After (Polygon)
import { PolygonAccount } from '@atxp/polygon';
const account = await PolygonAccount.initialize({
  provider: window.ethereum,
  walletAddress: address,
  useEphemeralWallet: true,
  allowance: BigInt('10000000'),
  periodInDays: 30,
  periodStart: Math.floor(Date.now() / 1000)
});
```

Key differences:
- No `apiKey` or `appName` required
- Must provide `provider` (EIP-1193 compatible)
- Must provide `periodStart` timestamp
- Uses Polygon mainnet USDC instead of Base USDC

## License

See the main ATXP SDK repository for license information.
