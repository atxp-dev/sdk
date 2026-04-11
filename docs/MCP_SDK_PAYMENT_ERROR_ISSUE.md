# MCP SDK Payment Error Wrapping Issue

**Date:** 2026-04-11
**Status:** Open — blocking X402 and MPP over MCP transport

## Problem

When an MCP tool handler throws an `McpError` (e.g., for a payment challenge), the `@modelcontextprotocol/sdk`'s `McpServer` class catches it and wraps it into a `CallToolResult`:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Payment via ATXP is required. ..." }]
}
```

This strips all structured data from `error.data` (x402 accepts, MPP challenges, charge amount, etc.). Only the error message string survives.

### Where the wrapping happens

`@modelcontextprotocol/sdk` → `dist/esm/server/mcp.js`:

```javascript
// Inside the CallToolRequest handler registered by McpServer
catch (error) {
    if (error instanceof McpError) {
        if (error.code === ErrorCode.UrlElicitationRequired) {
            throw error; // Only this code bypasses wrapping
        }
    }
    return this.createToolError(error instanceof Error ? error.message : String(error));
}
```

Only `UrlElicitationRequired` is re-thrown as a JSON-RPC error. All other McpErrors (including payment challenges with code `-32042` or `-30402`) are wrapped into tool results, discarding `error.data`.

### Impact

- **ATXP over MCP**: Works (partially). The client finds the payment URL from the text content and can trigger the ATXP authorize flow. But x402/mpp data is lost.
- **X402 over MCP**: Broken. The client needs `error.data.x402.accepts` to build payment requirements for `/authorize/x402`. Without it, the x402 path can't determine which chain/address to use.
- **MPP over MCP**: Broken. The client needs `error.data.mpp` (challenges array) to build MPP credentials. The MPP spec (https://mpp.dev/protocol/transports/mcp) requires JSON-RPC error code `-32042` with challenge data in `error.data`.
- **HTTP transport**: Not affected. HTTP 402 responses with `WWW-Authenticate` headers work correctly (used by the LLM gateway).

### How mppx handles this

The mppx library (`mppx/server`) provides two MCP transports:

1. **`Transport.mcp()`** — Returns raw JSON-RPC response objects. Bypasses the MCP SDK entirely. Works correctly.
2. **`Transport.mcpSdk()`** — Returns `McpError` instances for the tool handler to throw. Has the same wrapping problem we have.

The mppx `mcpSdk()` example shows:
```typescript
if (result.status === 402) throw result.challenge  // throws McpError
```

This McpError gets wrapped by `McpServer` into a tool result, losing the challenge data. mppx has the same bug.

## What works today

| Protocol | Transport | Status | Notes |
|----------|-----------|--------|-------|
| ATXP | MCP (dev:cli → dev:resource) | Partial | Authorize works, settlement works. No x402/mpp data. |
| X402 | MCP (dev:cli → dev:resource) | Broken | Client can't extract x402 accepts from tool result |
| MPP | MCP (dev:cli → dev:resource) | Broken | Client can't extract MPP challenges from tool result |
| ATXP | HTTP (LLM gateway) | Works | HTTP 402 + headers, not affected by tool wrapping |
| X402 | HTTP (LLM gateway) | Works | HTTP 402 + headers, not affected by tool wrapping |
| MPP | HTTP (LLM gateway) | Works | HTTP 402 + headers, not affected by tool wrapping |

## How to reproduce

### Prerequisites

Start all four services locally:

```bash
# Terminal 1: accounts (latest main)
cd accounts && npm run db:up && npm run migrate && npm run dev

# Terminal 2: auth (latest main)
cd auth && npm run dev

# Terminal 3: SDK resource server
cd sdk && npm run build && npm run build:dev && npm run dev:resource

# Terminal 4: Redis flags
redis-cli SET "ff:use-local-ledger" '"true"'
```

### Test ATXP (works)

```bash
redis-cli SET "ff:protocol-flag" '"atxp"'
cd sdk && node dist/cli.js http://localhost:3009 secure-data message=test
# Expected: "authorized via atxp" in output
# The tool result text contains the payment URL, client extracts it
```

### Test X402 + Solana (broken)

```bash
redis-cli SET "ff:protocol-flag" '"x402"'
redis-cli SET "ff:x402-chain" '"solana"'
cd sdk && node dist/cli.js http://localhost:3009 secure-data message=test
# Expected: "Destination not allowed for IOU conversion" or similar error
# Root cause: client receives tool result without x402 accepts,
# so paymentRequirements is not set, authorizeAuto enriches with
# account ID receiver, x402 route uses account ID as destination
```

### Test MPP + Tempo (broken)

```bash
redis-cli SET "ff:protocol-flag" '"mpp"'
redis-cli SET "ff:mpp-chain" '"tempo"'
cd sdk && node dist/cli.js http://localhost:3009 secure-data message=test
# Expected: "At least one MPP challenge is required"
# Root cause: client receives tool result without mpp challenges,
# no challenges passed to /authorize/mpp
```

### Verify the wrapping

Add debug logging to the published `@atxp/client` bundle to see what data reaches the client:

```bash
# In node_modules/@atxp/client/dist/index.js, find:
#   "const x402Data = errorData.x402;"
# Add before it:
#   console.log("[DEBUG] errorData keys:", Object.keys(errorData || {}).join(","));

# Also find:
#   "if (data.x402) {"
# Add before it:
#   console.log("[DEBUG] handler data keys:", Object.keys(data).join(","));
```

With debugging, you'll see:
- `errorData keys: paymentRequestId,paymentRequestUrl,chargeAmount` — no x402/mpp
- `handler data keys: paymentRequestId,paymentRequestUrl` — no x402/mpp

The x402 and mpp fields are present in the McpError thrown by `requirePayment`, but stripped by the MCP SDK's `createToolError` wrapper before reaching the client.

### Test via LLM (works — HTTP transport)

```bash
# Start LLM gateway
cd llm && npm run dev

# Run test script
redis-cli SET "ff:protocol-flag" '"x402"'
redis-cli SET "ff:x402-chain" '"solana"'
cd llm && ./test-anthropic-opus-4-6.sh
# Expected: All tests pass — LLM uses HTTP transport, not MCP
```

## Key files

- **Server (throws McpError):** `packages/atxp-server/src/requirePayment.ts` → `buildOmniError()` → `omniChallengeMcpError()`
- **Server (omni-challenge builder):** `packages/atxp-server/src/omniChallenge.ts` → `omniChallengeMcpError()` returns `new McpError(code, message, {x402, mpp, ...})`
- **Client (detects payment):** `packages/atxp-client/src/atxpFetcher.ts` → `checkForATXPResponse()` (line ~577) extracts error data
- **Client (builds synthetic response):** `packages/atxp-client/src/atxpFetcher.ts` → `buildSyntheticResponseFromMcpError()` (line ~668)
- **Client (extracts x402/mpp):** `packages/atxp-client/src/atxpAccountHandler.ts` → `buildAuthorizeParams()` (line ~83)
- **MCP SDK (wrapping):** `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` → `setRequestHandler(CallToolRequestSchema, ...)` catch block
- **mppx (same pattern):** `node_modules/mppx/dist/mcp-sdk/server/Transport.js` → `mcpSdk()` transport's `respondChallenge()`
