import { atxpCloudflareWorker } from "./cloudflareWorker.js";
import { ATXPCloudflareOptions } from "./types.js";

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
  return atxpCloudflareWorker(options)
}