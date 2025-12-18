/**
 * ChatGPT Authentication Helpers for ATXP MCP Servers
 *
 * This module provides utilities for triggering ChatGPT's authentication UI
 * from ATXP-protected MCP servers. ChatGPT expects authentication challenges
 * to be returned as MCP tool results with `_meta["mcp/www_authenticate"]`,
 * rather than HTTP-level 401 responses.
 */

import { Request, Response, NextFunction, Router } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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
  TokenProblem,
  ATXPConfig,
} from '@atxp/server';

// ============================================================================
// Types
// ============================================================================

/**
 * Authentication context stored for each request.
 * Available to tool handlers via context helpers.
 */
export type ChatGPTAuthContext = {
  tokenCheck: TokenCheck;
  resourceMetadataUrl: string;
  config: ATXPConfig;
  resource: URL;
};

/**
 * MCP tool result with authentication challenge metadata.
 * This format triggers ChatGPT's OAuth linking UI.
 */
export interface McpAuthChallenge extends CallToolResult {
  _meta: { 'mcp/www_authenticate': string[] };
  isError: true;
}

// ============================================================================
// Context Storage
// ============================================================================

const authContextStorage = new AsyncLocalStorage<ChatGPTAuthContext>();

/**
 * Check if the current request has valid authentication.
 * Returns true if a valid access token was provided.
 */
export function isAuthenticated(): boolean {
  const ctx = authContextStorage.getStore();
  return ctx?.tokenCheck.passes ?? false;
}

/**
 * Get the Protected Resource Metadata URL for the current request.
 * Used when constructing authentication challenges.
 */
export function getResourceMetadataUrl(): string | null {
  return authContextStorage.getStore()?.resourceMetadataUrl ?? null;
}

/**
 * Get the full token check result for the current request.
 * Useful for determining the specific authentication failure reason.
 */
export function getTokenCheck(): TokenCheck | null {
  return authContextStorage.getStore()?.tokenCheck ?? null;
}

/**
 * Get the ATXP config for the current request.
 */
export function getConfig(): ATXPConfig | null {
  return authContextStorage.getStore()?.config ?? null;
}

// ============================================================================
// Auth Challenge Helper
// ============================================================================

/**
 * Create an MCP tool result that triggers ChatGPT's authentication UI.
 *
 * This generates a properly formatted response with `_meta["mcp/www_authenticate"]`
 * containing RFC 6750 compliant WWW-Authenticate challenge values.
 *
 * @param resourceMetadataUrl - URL to the Protected Resource Metadata endpoint
 * @param tokenCheck - Optional token check result for determining error codes
 * @param message - Optional custom message to display to the user
 * @returns MCP tool result that triggers authentication UI
 *
 * @example
 * ```typescript
 * server.tool('premium_feature', schema, async () => {
 *   if (!isAuthenticated()) {
 *     return createMcpAuthChallenge(
 *       getResourceMetadataUrl()!,
 *       getTokenCheck()!,
 *       'Please sign in to use this feature'
 *     );
 *   }
 *   // ... tool implementation
 * });
 * ```
 */
export function createMcpAuthChallenge(
  resourceMetadataUrl: string,
  tokenCheck?: TokenCheck | null,
  message?: string
): McpAuthChallenge {
  // Map token problems to OAuth error codes per RFC 6750
  let error: string | undefined;
  let errorDescription: string | undefined;

  if (tokenCheck && !tokenCheck.passes) {
    switch (tokenCheck.problem) {
      case TokenProblem.NO_TOKEN:
        // RFC 6750: No error code when token is simply missing
        errorDescription = 'No access token provided';
        break;
      case TokenProblem.INVALID_TOKEN:
        error = 'invalid_token';
        errorDescription = 'The access token is invalid or expired';
        break;
      case TokenProblem.INVALID_AUDIENCE:
        error = 'invalid_token';
        errorDescription = 'The access token is not valid for this resource';
        break;
      case TokenProblem.NON_BEARER_AUTH_HEADER:
        error = 'invalid_request';
        errorDescription = 'Authorization header must use Bearer scheme';
        break;
      case TokenProblem.NON_SUFFICIENT_FUNDS:
        error = 'insufficient_scope';
        errorDescription = 'Insufficient funds in account';
        break;
      case TokenProblem.INTROSPECT_ERROR:
        error = 'invalid_token';
        errorDescription = 'Unable to validate access token';
        break;
      default:
        errorDescription = 'Authentication required';
    }
  } else {
    errorDescription = 'Authentication required';
  }

  // Build WWW-Authenticate value per RFC 6750 Section 3
  let wwwAuth = `Bearer resource_metadata="${resourceMetadataUrl}"`;
  if (error) wwwAuth += `, error="${error}"`;
  if (errorDescription) wwwAuth += `, error_description="${errorDescription}"`;

  return {
    content: [{
      type: 'text',
      text: message || errorDescription || 'Authentication required'
    }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [wwwAuth]
    }
  };
}

/**
 * Convenience function to check auth and return a challenge if not authenticated.
 * Returns null if authenticated, or an McpAuthChallenge if not.
 *
 * @param message - Optional custom message for the auth challenge
 * @returns null if authenticated, McpAuthChallenge if not
 *
 * @example
 * ```typescript
 * server.tool('premium_feature', schema, async () => {
 *   const authChallenge = requireAuth('Please sign in to continue');
 *   if (authChallenge) return authChallenge;
 *
 *   // User is authenticated, proceed...
 * });
 * ```
 */
export function requireAuth(message?: string): McpAuthChallenge | null {
  if (isAuthenticated()) {
    return null;
  }

  const resourceMetadataUrl = getResourceMetadataUrl();
  if (!resourceMetadataUrl) {
    // Fallback if context is missing (shouldn't happen in normal flow)
    return {
      content: [{ type: 'text', text: 'Authentication required (configuration error)' }],
      isError: true,
      _meta: { 'mcp/www_authenticate': ['Bearer'] }
    };
  }

  return createMcpAuthChallenge(resourceMetadataUrl, getTokenCheck(), message);
}

// ============================================================================
// Express Middleware
// ============================================================================

/**
 * Express middleware for ChatGPT-compatible ATXP authentication.
 *
 * Unlike the standard `atxpExpress()` middleware, this version:
 * - Does NOT block unauthenticated requests at the HTTP level
 * - Still serves Protected Resource Metadata (required for ChatGPT)
 * - Makes authentication context available to tool handlers
 * - Allows tools to return MCP-level auth challenges
 *
 * @param args - ATXP configuration arguments
 * @returns Express router middleware
 *
 * @example
 * ```typescript
 * import { atxpExpressChatGPT } from './chatgpt-auth.js';
 *
 * const atxpRouter = atxpExpressChatGPT({
 *   destination,
 *   payeeName: 'My ChatGPT App'
 * });
 *
 * app.use(atxpRouter);
 * ```
 */
export function atxpExpressChatGPT(args: ATXPArgs): Router {
  const config = buildServerConfig(args);
  const router = Router();

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logger = config.logger;
      const requestUrl = new URL(req.url, `${req.protocol}://${req.get('host')}`);
      logger.debug(`[ChatGPT Auth] Handling ${req.method} ${requestUrl.toString()}`);

      // Get resource URL for this request
      const resource = getResource(config, requestUrl, req.headers);

      // Serve Protected Resource Metadata (required for ChatGPT auth UI)
      const prmResponse = getProtectedResourceMetadata(config, requestUrl, req.headers);
      if (sendProtectedResourceMetadataNode(res, prmResponse)) {
        logger.debug('[ChatGPT Auth] Served Protected Resource Metadata');
        return;
      }

      // Serve OAuth Authorization Server Metadata (for legacy clients)
      const oAuthMetadata = await getOAuthMetadata(config, requestUrl);
      if (sendOAuthMetadataNode(res, oAuthMetadata)) {
        logger.debug('[ChatGPT Auth] Served OAuth Metadata');
        return;
      }

      // Check if this is an MCP request
      const mcpRequests = await parseMcpRequestsNode(config, requestUrl, req, req.body);
      if (mcpRequests.length === 0) {
        logger.debug('[ChatGPT Auth] Not an MCP request, passing through');
        return next();
      }

      logger.debug(`[ChatGPT Auth] Processing ${mcpRequests.length} MCP request(s)`);

      // Validate token (but don't block on failure)
      const tokenCheck = await checkTokenNode(config, resource, req);

      // Build resource metadata URL for potential auth challenges
      const resourceMetadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;

      logger.debug(`[ChatGPT Auth] Token check: ${tokenCheck.passes ? 'PASS' : `FAIL (${tokenCheck.passes === false ? tokenCheck.problem : 'unknown'})`}`);

      // Create auth context for tool handlers
      const authContext: ChatGPTAuthContext = {
        tokenCheck,
        resourceMetadataUrl,
        config,
        resource,
      };

      // Run the handler within auth context
      authContextStorage.run(authContext, () => {
        if (tokenCheck.passes) {
          // Token is valid, set up full ATXP context
          withATXPContext(config, resource, tokenCheck, next);
        } else {
          // Token invalid or missing, but still proceed to let tools handle it
          // Pass null token info so requirePayment etc. know there's no auth
          withATXPContext(config, resource, { token: null, data: null }, next);
        }
      });

    } catch (error) {
      config.logger.error(`[ChatGPT Auth] Critical error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'server_error',
        error_description: 'An internal server error occurred'
      });
    }
  };

  router.use(middleware);
  return router;
}
