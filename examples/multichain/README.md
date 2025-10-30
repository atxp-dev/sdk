# Multichain Payment Example

This example demonstrates how ATXP enables a single server to accept payments from multiple blockchain networks (Base/Ethereum, Solana, and Polygon Amoy testnet) without any chain-specific code on the server side.

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
   - `POLYGON_AMOY_PRIVATE_KEY`: (Optional) Your Polygon wallet private key for testnet testing

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
   - Make a payment from your Polygon Amoy account (if configured)
   - All payments go to the same server endpoint

## How It Works

1. **Server Setup**: The server uses `ATXPPaymentDestination` which delegates payment destination requests to the accounts.atxp.ai service.

2. **Multichain Support**: When a payment is required:
   - The accounts.atxp.ai service provides chain-specific payment addresses
   - Base payments go to an Ethereum address
   - Solana payments go to a Solana address
   - Both are controlled by the same accounts.atxp.ai service

3. **Client Flexibility**: Clients can use any supported chain:
   - `BaseAccount` for Base/Ethereum payments
   - `SolanaAccount` for Solana payments
   - `PolygonAccount` for Polygon payments (mainnet or testnet)
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
                     │   (Port 3009) │
┌──────────────┐     │              │
│Solana Client │────▶│              │
└──────────────┘     └──────┬───────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │accounts.atxp.ai │
                    │  (Handles both  │
                    │   Base & Solana)│
                    └─────────────────┘
```

## Testing Polygon Amoy Testnet (PR #101)

This example now includes support for Polygon Amoy testnet to test the new Polygon Amoy implementation.

### Setup for Polygon Amoy Testing:

1. **Get a Polygon wallet** (use MetaMask or any EVM wallet)

2. **Get test MATIC** for gas fees:
   - Visit: https://faucets.chain.link/polygon-amoy
   - Connect your wallet and request testnet MATIC

3. **Get test USDC** on Amoy:
   - USDC Contract: `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`
   - You can get test USDC from:
     - Polygon faucets that support USDC
     - Bridging from other testnets
     - Using a testnet DEX

4. **Configure your .env**:
   ```bash
   POLYGON_AMOY_RPC=https://rpc-amoy.polygon.technology
   POLYGON_AMOY_PRIVATE_KEY=0x_your_private_key_here
   ```

5. **Run the test**:
   ```bash
   npm run test-client
   ```

The test will automatically detect and use your Polygon Amoy configuration if present.

### Verification:

- View transactions on [Amoy PolygonScan](https://amoy.polygonscan.com)
- Verify the chain ID is 80002
- Check that USDC transfers use the correct contract address

## Troubleshooting

- **"Insufficient funds"**: Ensure your wallets have USDC on the respective chains
- **"Account does not exist" (Solana)**: The Solana wallet may need SOL for rent. The accounts.atxp.ai service should handle this automatically when the address is first requested.
- **Connection errors**: Verify accounts.atxp.ai is running and ATXP_DESTINATION is correct
- **Polygon Amoy errors**: Ensure you have both test MATIC (for gas) and test USDC