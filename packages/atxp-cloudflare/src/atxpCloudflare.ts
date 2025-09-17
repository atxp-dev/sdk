import { ATXPConfig, checkTokenWebApi, getOAuthMetadata, getProtectedResourceMetadata, parseMcpRequestsWebApi, sendOAuthChallengeWebApi, sendOAuthMetadataWebApi, sendProtectedResourceMetadataWebApi } from "@atxp/server";
import { ATXPCloudflareOptions } from "./types.js";
import { setATXPWorkerContext } from "./workerContext.js";
import { buildATXPConfig } from "./buildATXPConfig.js";

/**
 * Convenience function to create ATXP Cloudflare Worker with environment-based configuration
 *
 * Usage:
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
 *     const handler = atxpCloudflareWorker({
 *       mcpAgent: MyMCP,
 *       serviceName: "My MCP Server",
 *       allowHttp: env.ALLOW_INSECURE_HTTP_REQUESTS_DEV_ONLY_PLEASE === 'true',
 *       destination: env.FUNDING_DESTINATION,
 *       network: env.FUNDING_NETWORK
 *     });
 *     return handler.fetch(request, env, ctx);
 *   }
 * };
 * ```
 */
export function atxpCloudflare(options: ATXPCloudflareOptions) {
  const {
    mcpAgent,
    mountPaths = { mcp: "/mcp", sse: "/sse", root: "/" }
  } = options;

  // Destructure mount paths with guaranteed defaults
  const { mcp = "/mcp", sse = "/sse", root = "/" } = mountPaths;
  const config = buildATXPConfig(options)

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async fetch(request: Request, env: any, ctx: any): Promise<Response> {
      try {
        const url = new URL(request.url);
        const prmMetadata = getProtectedResourceMetadata(config, url);
        if (prmMetadata) {
          const prmResponse = sendProtectedResourceMetadataWebApi(prmMetadata);
          if (prmResponse) {
            return prmResponse;
          }
        }

        // Some older clients don't use PRM and assume the MCP server is an OAuth server
        const oAuthMetadata = await getOAuthMetadata(config, url);
        if (oAuthMetadata != null) {
          const oAuthResponse = sendOAuthMetadataWebApi(oAuthMetadata);
          if (oAuthResponse) {
            return oAuthResponse;
          }
        }

        // Handle ATXP middleware processing
        const atxpResponse = await handleRequest(config, request);
        if (atxpResponse) {
          return atxpResponse;
        }

        // Route to appropriate MCP endpoints
        if (url.pathname === sse || url.pathname === sse + "/message") {
          return mcpAgent.serveSSE(sse).fetch(request, env, ctx);
        }

        if (url.pathname === mcp || url.pathname === root) {
          return mcpAgent.serve(url.pathname).fetch(request, env, ctx);
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

async function handleRequest(config: ATXPConfig, request: Request): Promise<Response | null> {
  try {
    const logger = config.logger;
    const requestUrl = new URL(request.url);
    logger.debug(`ATXP Middleware: Handling ${request.method} ${requestUrl.toString()}`);

    // Create a basic resource URL
    const resource = new URL(requestUrl.origin);

    // Check if this is an MCP request by examining the request
    const clonedRequest = request.clone();
    const mcpRequests = await parseMcpRequestsWebApi(config, clonedRequest);
    logger.debug(`${mcpRequests.length} MCP requests found in request`);

    // If there are no MCP requests, let the request continue without authentication
    if (mcpRequests.length === 0) {
      logger.debug('No MCP requests found - letting request continue without ATXP processing');
      return null;
    }

    // Check the token using proper OAuth logic
    const tokenCheck = await checkTokenWebApi(config, resource, request);
    const user = tokenCheck.data?.sub ?? null;

    logger.debug(`Token check result: passes=${tokenCheck.passes}, user=${user}`);

    // Send OAuth challenge if needed
    const challengeResponse = sendOAuthChallengeWebApi(tokenCheck);
    if (challengeResponse) {
      logger.debug('Sending OAuth challenge response');
      return challengeResponse;
    }

    // Create and store context for this request using SDK-compatible structure
    setATXPWorkerContext(config, resource, tokenCheck);

    // Let the request continue to MCP handling
    return null;

  } catch (error) {
    config.logger.error(`Critical error in ATXP middleware: ${error instanceof Error ? error.message : String(error)}`);

    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'An internal server error occurred in ATXP middleware'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}