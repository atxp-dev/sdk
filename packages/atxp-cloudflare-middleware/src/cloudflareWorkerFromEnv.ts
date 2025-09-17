import { Network } from "@atxp/common";
import { atxpCloudflareWorker } from "./cloudflareWorker.js";
import { ATXPEnv } from "./types.js";
import { McpAgent } from "agents/mcp";

/**
 * Convenience function to create ATXP Cloudflare Worker with environment-based configuration
 *
 * Usage:
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
 *     const handler = atxpCloudflareWorkerFromEnv({
 *       mcpAgent: MyMCP,
 *       serviceName: "My MCP Server",
 *       allowHttp: env.ALLOW_INSECURE_HTTP_REQUESTS_DEV_ONLY_PLEASE === 'true',
 *       fundingDestination: env.FUNDING_DESTINATION,
 *       fundingNetwork: env.FUNDING_NETWORK
 *     });
 *     return handler.fetch(request, env, ctx);
 *   }
 * };
 * ```
 */
export function atxpCloudflareWorkerFromEnv(options: {
  mcpAgent: typeof McpAgent; // Using any to avoid dependency on specific agents type
  serviceName?: string;
  mountPaths?: { mcp?: string; sse?: string; root?: string; };
  allowHttp?: boolean;
  fundingDestination: string;
  fundingNetwork: Network;
}) {
  return {
    async fetch(request: Request, env: ATXPEnv, ctx: unknown): Promise<Response> {
      // Use the main atxpCloudflareWorker function with parameter-based config
      const handler = atxpCloudflareWorker({
        config: {
          fundingDestination: options.fundingDestination,
          fundingNetwork: options.fundingNetwork,
          payeeName: options.serviceName || 'MCP Server',
          allowHttp: options.allowHttp || false
        },
        mcpAgent: options.mcpAgent,
        serviceName: options.serviceName,
        mountPaths: options.mountPaths
      });

      return handler.fetch(request, env, ctx);
    }
  };
}