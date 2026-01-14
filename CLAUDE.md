# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

ATXP SDK is a TypeScript monorepo providing client and server libraries for the ATXP payment protocol. It supports multiple blockchain networks (Solana, Base, World Chain, Polygon) and integrates with MCP (Model Context Protocol) for AI agent payments.

## Common Commands

```bash
# Install dependencies
npm ci

# Build all packages
npm run build

# Type check all packages
npm run typecheck

# Lint all packages
npm run lint
```

## Testing

**IMPORTANT:** Run tests package-by-package because the root level `npm run test` tends to hide test failures.

```bash
# Run tests for a specific package
npm test -w packages/atxp-common
npm test -w packages/atxp-client
npm test -w packages/atxp-server
npm test -w packages/atxp-express
npm test -w packages/atxp-x402
# etc.

# Run all package tests individually (recommended for CI validation)
for pkg in packages/*/; do
  echo "Testing $pkg..."
  npm test -w "$pkg" || exit 1
done
```

## Architecture

This is an npm workspaces monorepo with the following packages:

- `packages/atxp-common` - Shared types and utilities
- `packages/atxp-client` - Client-side SDK for making payments
- `packages/atxp-server` - Server-side SDK for receiving payments
- `packages/atxp-express` - Express.js middleware integration
- `packages/atxp-cloudflare` - Cloudflare Workers integration
- `packages/atxp-base` - Base chain support
- `packages/atxp-solana` - Solana chain support
- `packages/atxp-polygon` - Polygon chain support
- `packages/atxp-worldchain` - World Chain support
- `packages/atxp-x402` - X402 payment protocol support
- `packages/atxp-sqlite` - SQLite storage for OAuth tokens
- `packages/atxp-redis` - Redis storage for OAuth tokens

## Key Patterns

### Workspace Dependencies

Packages depend on each other via workspace references. When adding new types or exports to `@atxp/common`, ensure:
1. The type is exported from `src/index.ts`
2. Run `npm run build -w packages/atxp-common` to regenerate dist files
3. Other packages will pick up changes via TypeScript project references

### Package Lock Issues

If you see TypeScript errors about missing properties in workspace packages, check `package-lock.json` for nested `node_modules/@atxp/*` entries that point to npm registry versions instead of local workspace versions. Remove these entries and run `npm ci` again.
