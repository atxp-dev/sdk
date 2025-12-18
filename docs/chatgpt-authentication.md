# Triggering Authentication UI in ChatGPT

This guide explains how to implement ATXP-protected MCP servers that work with ChatGPT's authentication UI.

## Overview

When ATXP-protected MCP servers are accessed via ChatGPT's MCP app platform, authentication failures must be signaled differently than in traditional HTTP clients. ChatGPT expects **MCP tool results** containing `_meta["mcp/www_authenticate"]` rather than HTTP 401 responses.

The standard `atxpExpress()` middleware blocks unauthenticated requests at the HTTP level, which doesn't trigger ChatGPT's OAuth linking UI. This guide shows how to work around this limitation.

## How ChatGPT Authentication Works

ChatGPT triggers its OAuth linking UI when **both** conditions are met:

1. **Protected Resource Metadata** is served at `/.well-known/oauth-protected-resource`
2. **Tool results** include `_meta["mcp/www_authenticate"]` with a properly formatted challenge

The expected response format:

```json
{
  "content": [{ "type": "text", "text": "Please sign in to continue" }],
  "isError": true,
  "_meta": {
    "mcp/www_authenticate": [
      "Bearer resource_metadata=\"https://your-server.com/.well-known/oauth-protected-resource/\", error=\"invalid_token\", error_description=\"No access token provided\""
    ]
  }
}
```

## Architecture Comparison

| Aspect | Standard `atxpExpress()` | ChatGPT-Compatible |
|--------|--------------------------|-------------------|
| Auth failure response | HTTP 401 + `WWW-Authenticate` header | MCP tool result with `_meta` |
| Unauthenticated requests | Blocked at middleware level | Reach tool handlers |
| Auth check location | Middleware (automatic) | Tool handler (manual) |
| Payment check | After middleware auth | After manual auth check |

## Implementation

### Step 1: Create Custom Middleware

Create a middleware that serves metadata but doesn't block unauthenticated requests:

```typescript
// chatgpt-auth.ts
import { Request, Response, NextFunction, Router } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import {
  ATXPArgs,
  buildServerConfig,
  checkTokenNode,
  withATXPContext,
  parseMcpRequestsNode,
  getProtectedResourceMetadata,
  getResource,
  getOAuthMetadata,
  sendProtectedResourceMetadataNode,
  sendOAuthMetadataNode,
  TokenCheck,
  ATXPConfig,
} from '@atxp/server';

type ChatGPTAuthContext = {
  tokenCheck: TokenCheck;
  resourceMetadataUrl: string;
  config: ATXPConfig;
  resource: URL;
};

const authContextStorage = new AsyncLocalStorage<ChatGPTAuthContext>();

export function isAuthenticated(): boolean {
  const ctx = authContextStorage.getStore();
  return ctx?.tokenCheck.passes ?? false;
}

export function getResourceMetadataUrl(): string | null {
  return authContextStorage.getStore()?.resourceMetadataUrl ?? null;
}

export function getTokenCheck(): TokenCheck | null {
  return authContextStorage.getStore()?.tokenCheck ?? null;
}

export function atxpExpressChatGPT(args: ATXPArgs): Router {
  const config = buildServerConfig(args);
  const router = Router();

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestUrl = new URL(req.url, `${req.protocol}://${req.get('host')}`);
      const resource = getResource(config, requestUrl, req.headers);

      // Serve Protected Resource Metadata (required for ChatGPT)
      const prmResponse = getProtectedResourceMetadata(config, requestUrl, req.headers);
      if (sendProtectedResourceMetadataNode(res, prmResponse)) {
        return;
      }

      // Serve OAuth metadata for legacy clients
      const oAuthMetadata = await getOAuthMetadata(config, requestUrl);
      if (sendOAuthMetadataNode(res, oAuthMetadata)) {
        return;
      }

      // Check if this is an MCP request
      const mcpRequests = await parseMcpRequestsNode(config, requestUrl, req, req.body);
      if (mcpRequests.length === 0) {
        return next();
      }

      // Validate token (but don't block on failure)
      const tokenCheck = await checkTokenNode(config, resource, req);
      const resourceMetadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;

      const authContext: ChatGPTAuthContext = {
        tokenCheck,
        resourceMetadataUrl,
        config,
        resource,
      };

      // Run handler with auth context available
      authContextStorage.run(authContext, () => {
        if (tokenCheck.passes) {
          withATXPContext(config, resource, tokenCheck, next);
        } else {
          withATXPContext(config, resource, { token: null, data: null }, next);
        }
      });

    } catch (error) {
      res.status(500).json({ error: 'server_error' });
    }
  };

  router.use(middleware);
  return router;
}
```

### Step 2: Create Auth Challenge Helper

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TokenProblem } from '@atxp/server';

export interface McpAuthChallenge extends CallToolResult {
  _meta: { 'mcp/www_authenticate': string[] };
  isError: true;
}

export function createMcpAuthChallenge(
  resourceMetadataUrl: string,
  tokenCheck?: TokenCheck | null,
  message?: string
): McpAuthChallenge {
  let error: string | undefined;
  let errorDescription: string | undefined;

  if (tokenCheck && !tokenCheck.passes) {
    switch (tokenCheck.problem) {
      case TokenProblem.NO_TOKEN:
        errorDescription = 'No access token provided';
        break;
      case TokenProblem.INVALID_TOKEN:
      case TokenProblem.INVALID_AUDIENCE:
        error = 'invalid_token';
        errorDescription = 'The access token is invalid or expired';
        break;
      case TokenProblem.NON_SUFFICIENT_FUNDS:
        error = 'insufficient_scope';
        errorDescription = 'Insufficient funds';
        break;
      default:
        errorDescription = 'Authentication required';
    }
  }

  let wwwAuth = `Bearer resource_metadata="${resourceMetadataUrl}"`;
  if (error) wwwAuth += `, error="${error}"`;
  if (errorDescription) wwwAuth += `, error_description="${errorDescription}"`;

  return {
    content: [{ type: 'text', text: message || errorDescription || 'Authentication required' }],
    isError: true,
    _meta: { 'mcp/www_authenticate': [wwwAuth] }
  };
}

export function requireAuth(message?: string): McpAuthChallenge | null {
  if (isAuthenticated()) return null;

  const resourceMetadataUrl = getResourceMetadataUrl();
  if (!resourceMetadataUrl) {
    return {
      content: [{ type: 'text', text: 'Configuration error' }],
      isError: true,
      _meta: { 'mcp/www_authenticate': ['Bearer'] }
    };
  }

  return createMcpAuthChallenge(resourceMetadataUrl, getTokenCheck(), message);
}
```

### Step 3: Use in Tool Handlers

```typescript
import { atxpExpressChatGPT, isAuthenticated, requireAuth } from './chatgpt-auth.js';
import { requirePayment, atxpAccountId } from '@atxp/server';

// Setup middleware
const atxpRouter = atxpExpressChatGPT({
  destination,
  payeeName: 'My ChatGPT App'
});
app.use(atxpRouter);

// Tool that requires authentication
server.tool('premium_feature', schema, async (args) => {
  // Check auth - returns challenge if not authenticated
  const authChallenge = requireAuth('Please sign in to use this feature');
  if (authChallenge) return authChallenge;

  // User is authenticated, now check payment
  await requirePayment({ price: BigNumber(0.01) });

  // Proceed with tool logic
  return {
    content: [{ type: 'text', text: `Hello, ${atxpAccountId()}!` }]
  };
});

// Tool that works without auth
server.tool('public_info', {}, async () => {
  return {
    content: [{ type: 'text', text: 'This is public information.' }]
  };
});
```

## Complete Example

See the [`examples/chatgpt-server`](../examples/chatgpt-server/) directory for a complete working implementation.

## API Reference

### Middleware

#### `atxpExpressChatGPT(args: ATXPArgs): Router`

Creates Express middleware for ChatGPT-compatible authentication. Unlike `atxpExpress()`, this middleware:
- Does NOT block unauthenticated requests
- Still serves Protected Resource Metadata
- Makes auth context available to tool handlers

### Context Helpers

#### `isAuthenticated(): boolean`

Returns `true` if the current request has a valid access token.

#### `getResourceMetadataUrl(): string | null`

Returns the Protected Resource Metadata URL for constructing auth challenges.

#### `getTokenCheck(): TokenCheck | null`

Returns the full token validation result, including failure reason.

### Auth Challenge Helpers

#### `requireAuth(message?: string): McpAuthChallenge | null`

Convenience function that returns `null` if authenticated, or a properly formatted auth challenge if not.

#### `createMcpAuthChallenge(resourceMetadataUrl, tokenCheck?, message?): McpAuthChallenge`

Creates a properly formatted MCP auth challenge with `_meta["mcp/www_authenticate"]`.

## WWW-Authenticate Format

The `mcp/www_authenticate` value follows [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750) format:

```
Bearer resource_metadata="<url>"[, error="<code>"][, error_description="<desc>"]
```

Error codes:
- `invalid_token` - Token is expired, revoked, or malformed
- `invalid_request` - Request is malformed (e.g., non-Bearer auth header)
- `insufficient_scope` - Token lacks required scope/permissions

## Troubleshooting

### Auth UI doesn't appear in ChatGPT

1. **Check Protected Resource Metadata**: Verify it's accessible:
   ```bash
   curl https://your-server.com/.well-known/oauth-protected-resource/
   ```

2. **Verify `_meta` format**: The key must be exactly `mcp/www_authenticate` (with slash, not underscore)

3. **Check `resource_metadata` URL**: Must be accessible and return valid JSON

### Token validation fails

1. Verify your ATXP connection string is correct
2. Check that the authorization server URL matches your configuration
3. Enable debug logging to see token introspection details

## See Also

- [OpenAI Apps SDK Auth Documentation](https://developers.openai.com/apps-sdk/build/auth)
- [RFC 6750: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
- [Protected Resource Metadata (RFC 8414)](https://datatracker.ietf.org/doc/html/rfc8414)
