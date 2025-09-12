# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
```bash
npm run build          # Build all workspace packages
npm run build:dev      # TypeScript build for development
npm run typecheck      # Type checking across workspaces
npm run clean          # Remove dist/build artifacts
```

### Testing
```bash
npm run test           # Run all tests
npm run test:integration # Run integration tests (requires Redis)
npm test -- <pattern>  # Run specific test files matching pattern
```

### Code Quality
```bash
npm run lint           # Lint all packages
npm run lint:fix       # Auto-fix linting issues
```

### Development Servers
```bash
npm run dev:cli        # Run CLI development server
npm run dev:resource   # Run resource development server
```

## Architecture Overview

This is a TypeScript monorepo implementing the ATXP (Authorization Token Exchange Protocol) framework for building agents with OAuth authentication and blockchain payments.

### Package Structure
- **atxp-common**: Core shared utilities, types, and platform abstraction layer
- **atxp-client**: MCP client with OAuth authentication and payment processing
- **atxp-server**: Express.js-based MCP server with payment gating capabilities
- **atxp-base**: High-level package combining client and server functionality
- **atxp-sqlite/redis**: Database adapters for OAuth token storage

### Key Components

**Platform Abstraction** (`packages/atxp-common/src/platform/`): Cross-platform compatibility layer supporting Node.js, Browser, React Native, and Expo environments with unified crypto operations.

**OAuth Resource Management** (`packages/atxp-common/src/oAuthResource.ts`): Complete OAuth 2.0 implementation with PKCE flow, token management, and pluggable database adapters.

**Payment Processing**: Multi-chain payment system supporting Solana and Base networks with USDC transactions, integrated with Solana Pay and viem.

**MCP Integration**: Model Context Protocol implementation enabling AI agents to interact with authenticated resources and process payments.

## Tech Stack
- **TypeScript 5.7.3** targeting ES2020
- **Vitest** for testing with Node.js environment
- **ESLint 9** with TypeScript ESLint plugins
- **Express.js 5.0** for MCP server
- **Solana/Base blockchain** integration
- **oauth4webapi** and **jose** for OAuth/JWT

## Environment Setup

Required environment variables for development:
```bash
SOLANA_ENDPOINT=         # Solana RPC endpoint
SOLANA_PRIVATE_KEY=      # Base58 encoded private key
NODE_ENV=development
```

Optional for full functionality:
```bash
BASE_RPC=               # Base network RPC endpoint
BASE_PRIVATE_KEY=       # Base network private key
DEBUG=1                 # Enable debug logging
```

## Testing Notes
- Integration tests require Redis service
- Tests run against multiple Node.js versions (18, 20, 22)
- Cross-platform testing includes browser simulation with jsdom
- Package manager compatibility tested with npm/pnpm/yarn/bun

## Code Conventions
- Use barrel exports from index.ts files
- Import all files with `.js` extension (including TypeScript files)
- Prefer async/await over Promises
- Platform detection through runtime environment checks
- Custom error types (e.g., PaymentRequiredError) for domain-specific errors