# Multichain Payment Example

This example demonstrates how ATXP enables a single server to accept payments from multiple blockchain networks (Base/Ethereum, Solana, and Polygon) without any chain-specific code on the server side.

## Overview

The example consists of:
- **Server**: An MCP server that requires payment for tool calls, using ATXPPaymentDestination for multichain support
- **Test Client**: Demonstrates making payments from both Base and Solana accounts to the same server

## Prerequisites

1. **accounts.atxp.ai service**: The multichain accounts service must be running
   ```bash
   cd ../../accounts-mc
   npm start
   ```

2. **Environment variables**: Copy `.env.example` to `.env` and configure:
   - `ATXP_DESTINATION`: Connection string from accounts.atxp.ai service
   - `BASE_PRIVATE_KEY`: Your Base/Ethereum wallet private key (with USDC)
   - `SOLANA_PRIVATE_KEY`: Your Solana wallet private key (with USDC)
   - `POLYGON_PRIVATE_KEY`: Your Polygon wallet private key (with USDC)

## Installation

```bash
npm install
```

## Running the Example

1. **Start the server**:
   ```bash
   npm start
   ```
   The server will start on port 3009 (or PORT from .env).

2. **Run the test client** (in another terminal):
   ```bash
   npm run test-client
   ```
   This will:
   - Make a payment from your Base account
   - Make a payment from your Solana account
   - Make a payment from your Polygon account
   - All payments go to the same server endpoint

## How It Works

1. **Server Setup**: The server uses `ATXPPaymentDestination` which delegates payment destination requests to the accounts.atxp.ai service.

2. **Multichain Support**: When a payment is required:
   - The accounts.atxp.ai service provides chain-specific payment addresses
   - Base payments go to an Ethereum address
   - Solana payments go to a Solana address
   - Polygon payments go to a Polygon address
   - All are controlled by the same accounts.atxp.ai service

3. **Client Flexibility**: Clients can use any supported chain:
   - `BaseAccount` for Base/Ethereum payments
   - `SolanaAccount` for Solana payments
   - `PolygonAccount` for Polygon payments
   - The server doesn't need to know which chain the client is using

## Key Benefits

- **Single Server Codebase**: No chain-specific logic needed on the server
- **Automatic Chain Detection**: The payment system automatically handles different chains
- **Unified Balance**: All payments (regardless of chain) contribute to the same balance in accounts.atxp.ai
- **Easy Expansion**: Adding new chains only requires updates to accounts.atxp.ai, not your server

## Architecture

```
┌──────────────┐     ┌──────────────┐
│ Base Client  │────▶│              │
└──────────────┘     │  MCP Server  │
┌──────────────┐     │   (Port 3009) │
│Solana Client │────▶│              │
└──────────────┘     │              │
┌──────────────┐     │              │
│Polygon Client│────▶│              │
└──────────────┘     └──────┬───────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │accounts.atxp.ai │
                    │   (Handles all  │
                    │      chains)    │
                    └─────────────────┘
```

## Testing Polygon Support (PR #101)

This example now includes support for Polygon mainnet payments.

### Setup for Polygon Testing:

1. **Get a Polygon wallet** (use MetaMask or any EVM wallet)

2. **Get POL** for gas fees and **USDC** for payments:
   - Bridge assets to Polygon mainnet
   - Note: Polygon's native currency is POL (upgraded from MATIC in Sept 2024)
   - USDC Contract on Polygon: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (Native USDC)

3. **Configure your .env**:
   ```bash
   POLYGON_RPC=https://polygon-rpc.com
   POLYGON_PRIVATE_KEY=0x_your_private_key_here
   ```

4. **Run the test**:
   ```bash
   npm run test-client
   ```

The test will automatically detect and use your Polygon configuration if present.

### Verification:

- View transactions on [PolygonScan](https://polygonscan.com)
- Verify the chain ID is 137
- Check that USDC transfers use the correct contract address

## Troubleshooting

- **"Insufficient funds"**: Ensure your wallets have USDC on the respective chains
- **"Account does not exist" (Solana)**: The Solana wallet may need SOL for rent. The accounts.atxp.ai service should handle this automatically when the address is first requested.
- **Connection errors**: Verify accounts.atxp.ai is running and ATXP_DESTINATION is correct
- **Polygon errors**: Ensure you have both POL (for gas) and USDC on Polygon mainnet