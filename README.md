# ATXP SDK

ATXP is a framework for building and running agents that can interact with the world. See [docs.atxp.ai](https://docs.atxp.ai) for documentation and examples.

## Supported Chains

ATXP supports payments on the following blockchain networks:

- **Base** (Ethereum L2) - Mainnet & Sepolia testnet
- **World Chain** - Mainnet & Sepolia testnet
- **Polygon** - Mainnet & Amoy testnet
- **Solana** - Mainnet

All chains support USDC payments with automatic network detection and unified balance management.

## Package Overview

This monorepo contains the following packages:

- `@atxp/client` - Client library for ATXP protocol
- `@atxp/server` - Server implementation for ATXP protocol
- `@atxp/common` - Shared types and utilities
- `@atxp/base` - Base/Ethereum chain support
- `@atxp/worldchain` - World Chain support
- `@atxp/polygon` - Polygon chain support
- `@atxp/express` - Express.js middleware
- `@atxp/cloudflare` - Cloudflare Workers support
- `@atxp/x402` - HTTP 402 Payment Required support
- `@atxp/sqlite` - SQLite storage backend
- `@atxp/redis` - Redis storage backend

## Getting Started

Visit [docs.atxp.ai](https://docs.atxp.ai) for full documentation, tutorials, and API reference.

## Community

Have questions or need help? Join our [Discord community](https://discord.gg/FuJXHhe9aW) - we're happy to help!