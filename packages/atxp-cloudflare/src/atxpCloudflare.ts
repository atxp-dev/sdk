/* eslint-disable @typescript-eslint/no-explicit-any */
import { atxpCloudflareWorker } from "./cloudflareWorker.js";
import { ATXPEnv, ATXPCloudflareOptions } from "./types.js";

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
  return {
    async fetch(request: Request, env: ATXPEnv, ctx: any): Promise<Response> {
      // Use the main atxpCloudflareWorker function with parameter-based config
      const handler = atxpCloudflareWorker({
        config: {
          destination: options.destination,
          network: options.network,
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