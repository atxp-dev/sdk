# @atxp/worldchain

ATXP for World Chain Mini Apps - Enable seamless payments in World Chain applications using MiniKit.

## Overview

`@atxp/worldchain` provides a complete solution for integrating ATXP (Autonomous Transaction eXecution Protocol) payments into World Chain Mini Apps. It handles World Chain-specific wallet interactions, USDC transfers, and MiniKit integration while abstracting away the complexity of blockchain transactions.

## Installation

```bash
npm install @atxp/worldchain
```

### Peer Dependencies

```bash
npm install viem @worldcoin/minikit-js
```

## Quick Start

### 1. Create a Worldchain Account

```typescript
import { createMiniKitWorldchainAccount } from '@atxp/worldchain';
import { MiniKit } from '@worldcoin/minikit-js';

const account = await createMiniKitWorldchainAccount({
  walletAddress: '0x1234...', // User's wallet address
  miniKit: MiniKit
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
    console.log('Payment failed:', payment, error);
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

Here's how to integrate ATXP Worldchain into a React application:

```typescript
import { createMiniKitWorldchainAccount, WorldchainAccount } from '@atxp/worldchain';
import { atxpClient } from '@atxp/client';
import { MiniKit } from '@worldcoin/minikit-js';
import { useCallback, useEffect, useState } from 'react';

export const AtxpProvider = ({ children }) => {
  const [atxpAccount, setAtxpAccount] = useState<WorldchainAccount | null>(null);
  const [atxpClient, setAtxpClient] = useState(null);

  const loadAccount = useCallback(async (walletAddress: string) => {
    const account = await createMiniKitWorldchainAccount({
      walletAddress,
      miniKit: MiniKit
    });
    setAtxpAccount(account);

    const client = await atxpClient({
      account,
      mcpServer: 'https://your-mcp-server.com',
      onPayment: async ({ payment }) => {
        console.log('Payment successful:', payment);
      }
    });
    setAtxpClient(client);
  }, []);

  // Initialize when wallet connects
  useEffect(() => {
    if (walletAddress && !atxpAccount) {
      loadAccount(walletAddress);
    }
  }, [walletAddress, atxpAccount, loadAccount]);

  const generateImage = useCallback(async (prompt: string) => {
    if (!atxpClient) return null;

    const response = await atxpClient.callTool({
      name: 'image_generator',
      arguments: { prompt }
    });

    return response;
  }, [atxpClient]);

  return (
    <AtxpContext.Provider value={{ atxpAccount, generateImage }}>
      {children}
    </AtxpContext.Provider>
  );
};
```

## API Reference

### `createMiniKitWorldchainAccount(options)`

Creates and initializes a Worldchain account with MiniKit integration.

#### Parameters

- `walletAddress: string` - The user's wallet address
- `miniKit: typeof MiniKit` - MiniKit instance for transaction signing
- `logger?: Logger` - Optional logger for debugging
- `customRpcUrl?: string` - Optional custom RPC URL (defaults to public Worldchain RPC)

#### Returns

`Promise<WorldchainAccount>` - Initialized Worldchain account

### `WorldchainAccount`

The main account class that handles Worldchain interactions.

#### Key Features

- **USDC Transfers**: Handles ERC-20 USDC transfers via MiniKit
- **Message Signing**: Signs messages using World App's secure signing
- **Smart Wallet Integration**: Works with Worldchain's account abstraction
- **Spend Permissions**: Manages recurring payment permissions

### `WorldchainPaymentMaker`

Handles payment processing for ATXP transactions.

### `MainWalletPaymentMaker`

Alternative payment processor for main wallet integrations.

### Caching System

```typescript
import { BrowserCache, MemoryCache } from '@atxp/worldchain';

// Browser-based cache for persistent storage
const cache = new BrowserCache();

// Memory cache for temporary storage
const memoryCache = new MemoryCache();
```

## Configuration

### Default Configuration

The package comes with sensible defaults:

- **Chain**: Worldchain Mainnet (Chain ID: 480)
- **RPC**: Public Worldchain RPC endpoint
- **Allowance**: 10 USDC
- **Permission Period**: 30 days
- **Wallet Mode**: Regular (non-ephemeral)

### Custom RPC Endpoint

```typescript
const account = await createMiniKitWorldchainAccount({
  walletAddress: '0x1234...',
  customRpcUrl: 'https://your-worldchain-rpc.com',
  miniKit: MiniKit
});
```

## Error Handling

The library provides detailed error handling for common scenarios:

### Insufficient Balance

```typescript
try {
  await client.callTool({ name: 'expensive_tool', arguments: {} });
} catch (error) {
  if (error.message.includes('transfer amount exceeds balance')) {
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
    }
  }
});
```

## Supported Networks

- **Worldchain Mainnet** (Chain ID: 480)

## Requirements

- Node.js 16+ or modern browser environment
- World App with MiniKit support
- USDC balance on Worldchain

## Example Application

See the complete example in https://github.com/atxp-dev/worldchain-demo-app which demonstrates:

- React Context integration
- Image generation with ATXP payments
- Error handling and user feedback
- Async operation management
