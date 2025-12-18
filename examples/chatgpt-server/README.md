# ATXP ChatGPT-Compatible Server Example

This example demonstrates how to create an MCP server with ATXP payment protection that works with ChatGPT's authentication UI.

## Background

When MCP servers are accessed via ChatGPT, authentication failures must be signaled differently than in traditional HTTP clients. ChatGPT expects **MCP tool results** containing `_meta["mcp/www_authenticate"]` rather than HTTP 401 responses.

This example shows how to implement this pattern using ATXP's lower-level APIs.

## Key Differences from Standard ATXP Server

| Aspect | Standard `atxpExpress()` | ChatGPT-Compatible |
|--------|--------------------------|-------------------|
| Auth failure response | HTTP 401 + `WWW-Authenticate` header | MCP tool result with `_meta["mcp/www_authenticate"]` |
| Unauthenticated requests | Blocked at middleware | Reach tool handlers |
| Auth check location | Middleware (automatic) | Tool handler (manual) |

## Features

- **ChatGPT-compatible auth**: Returns MCP-level auth challenges that trigger ChatGPT's OAuth linking UI
- **Mixed auth tools**: Some tools work anonymously, others require authentication
- **Payment integration**: Premium tools require ATXP payment after authentication
- **Protected Resource Metadata**: Automatically served for ChatGPT's OAuth discovery

## Available Tools

| Tool | Auth Required | Payment | Description |
|------|---------------|---------|-------------|
| `public_info` | No | No | Returns public information |
| `auth_status` | No | No | Shows your authentication status |
| `protected_data` | Yes | No | Access protected data |
| `premium_greeting` | Yes | 0.01 USDC | Personalized greeting |

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp env.example .env
   ```

   Edit `.env` and add your ATXP connection string from [accounts.atxp.ai](https://accounts.atxp.ai).

3. **Build packages** (from repository root):
   ```bash
   npm run build
   ```

## Running

### Development Mode
```bash
npm run dev
# or
./dev.sh
```

### Production Mode
```bash
npm run build
npm start
```

The server runs on port 3011 by default (configurable via `PORT` env var).

## How It Works

### 1. Custom Middleware (`chatgpt-auth.ts`)

Instead of `atxpExpress()`, this example uses `atxpExpressChatGPT()` which:
- Serves Protected Resource Metadata (required for ChatGPT)
- Validates tokens but doesn't block on failure
- Makes auth context available to tool handlers

### 2. Tool-Level Auth Checks

Tools that require authentication use the `requireAuth()` helper:

```typescript
server.tool('protected_feature', schema, async () => {
  // Returns auth challenge if not authenticated, null otherwise
  const authChallenge = requireAuth('Please sign in to continue');
  if (authChallenge) return authChallenge;

  // User is authenticated, proceed...
});
```

### 3. MCP Auth Challenge Format

When authentication is required, tools return:

```json
{
  "content": [{ "type": "text", "text": "Please sign in to continue" }],
  "isError": true,
  "_meta": {
    "mcp/www_authenticate": [
      "Bearer resource_metadata=\"https://example.com/.well-known/oauth-protected-resource/\", error=\"invalid_token\", error_description=\"No access token provided\""
    ]
  }
}
```

This format triggers ChatGPT's OAuth linking UI.

## Testing

### Without Authentication

Call `public_info` or `auth_status` - these work without any token:

```bash
curl -X POST http://localhost:3011/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "public_info",
      "arguments": {}
    }
  }'
```

### Triggering Auth Challenge

Call `protected_data` without a token to see the auth challenge:

```bash
curl -X POST http://localhost:3011/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "protected_data",
      "arguments": {}
    }
  }'
```

Response will include `_meta["mcp/www_authenticate"]`.

### Health Check

```bash
curl http://localhost:3011/health
```

## API Reference

### `atxpExpressChatGPT(args)`

Creates Express middleware for ChatGPT-compatible authentication.

```typescript
import { atxpExpressChatGPT } from './chatgpt-auth.js';

const router = atxpExpressChatGPT({
  destination,
  payeeName: 'My App'
});
```

### `isAuthenticated()`

Returns `true` if the current request has a valid access token.

### `requireAuth(message?)`

Returns `null` if authenticated, or an `McpAuthChallenge` if not.

### `createMcpAuthChallenge(resourceMetadataUrl, tokenCheck?, message?)`

Creates a properly formatted MCP auth challenge response.

### `getResourceMetadataUrl()`

Returns the Protected Resource Metadata URL for the current request.

### `getTokenCheck()`

Returns the full token validation result.

## Architecture

```
Request Flow:
┌─────────────────────────────────────────────────────────────────┐
│                        Express App                               │
├─────────────────────────────────────────────────────────────────┤
│  atxpExpressChatGPT Middleware                                  │
│  ├─ Serve /.well-known/oauth-protected-resource                 │
│  ├─ Validate token (don't block)                                │
│  └─ Set auth context                                            │
├─────────────────────────────────────────────────────────────────┤
│  MCP Server Handler                                             │
│  └─ Tool Handlers                                               │
│      ├─ Check isAuthenticated() or requireAuth()                │
│      ├─ Return auth challenge if needed                         │
│      └─ Call requirePayment() if authenticated                  │
└─────────────────────────────────────────────────────────────────┘
```

## See Also

- [ChatGPT Authentication Documentation](../../docs/chatgpt-authentication.md) - Full documentation
- [Standard Server Example](../server/) - Traditional HTTP-level auth
- [OpenAI Apps SDK Auth Docs](https://developers.openai.com/apps-sdk/build/auth) - OpenAI's documentation
