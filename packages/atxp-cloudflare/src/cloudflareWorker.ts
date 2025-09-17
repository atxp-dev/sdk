/* eslint-disable @typescript-eslint/no-explicit-any */
import { ATXPMcpApi } from "./mcpApi.js";
import { ATXPAuthContext, ATXPCloudflareOptions } from "./types.js";

/**
 * Cloudflare Workers equivalent of atxpServer() - wraps an MCP server with ATXP authentication and payments
 *
 * Usage:
 * ```typescript
 * export default atxpCloudflareWorker({
 *   config: { destination: "0x...", network: "base" },
 *   mcpAgent: MyMCP,
 *   serviceName: "My MCP Server"
 * });
 * ```
 */
export function atxpCloudflareWorker(options: ATXPCloudflareOptions) {
  const {
    mcpAgent,
    mountPaths = { mcp: "/mcp", sse: "/sse", root: "/" }
  } = options;

  // Destructure mount paths with guaranteed defaults
  const { mcp = "/mcp", sse = "/sse", root = "/" } = mountPaths;

  return {
    async fetch(request: Request, env: any, ctx: any): Promise<Response> {
      try {
        // Initialize ATXP for each request in case of Cloudflare Workers isolation
        if (!ATXPMcpApi.isInitialized()) {
          ATXPMcpApi.init(options);
        }

        const url = new URL(request.url);
        const resourceUrl = url.origin + "/";

        // Handle OAuth metadata endpoint BEFORE authentication
        if (url.pathname === "/.well-known/oauth-protected-resource") {
          return ATXPMcpApi.createOAuthMetadata(resourceUrl, options.payeeName);
        }

        // Initialize empty auth context
        let authContext: ATXPAuthContext = {};

        // Handle ATXP middleware processing
        try {
          // Check if ATXP middleware should handle this request
          const atxpResponse = await ATXPMcpApi.getMiddleware().handleRequest(request);
          if (atxpResponse) {
            return atxpResponse;
          }

          // Extract authentication data from ATXP context
          authContext = ATXPMcpApi.createAuthContext();
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('ATXP middleware error:', error);
        }

        // Create extended context with props and ATXP initialization params for MCP handler
        // Note: We pass the original config options rather than the built config
        // because the built config contains class instances that don't serialize
        const extendedCtx = {
          ...(ctx as any),
          props: {
            ...authContext,
            atxpInitParams: {
              ...options,
              resourceUrl  // Pass consistent resource URL
            }
          }
        };

        // Route to appropriate MCP endpoints
        if (url.pathname === sse || url.pathname === sse + "/message") {
          return mcpAgent.serveSSE(sse).fetch(request, env, extendedCtx);
        }

        if (url.pathname === mcp) {
          return mcpAgent.serve(mcp).fetch(request, env, extendedCtx);
        }

        // Handle root path for MCP connections
        if (url.pathname === root) {
          return mcpAgent.serve(root).fetch(request, env, extendedCtx);
        }

        return new Response("Not found", { status: 404 });

      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error in ATXP Cloudflare Worker handler:', error);
        return new Response(JSON.stringify({
          error: 'server_error',
          error_description: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  };
}