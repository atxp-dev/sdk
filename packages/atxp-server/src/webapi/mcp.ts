import { JSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import { ATXPConfig } from "../types.js";
import { parseMcpRequestsCore } from "../core/mcp.js";

/**
 * Web API implementation of MCP request parsing for Cloudflare Workers, Deno, etc.
 * Handles Web API Request parsing and delegates to core logic
 */
export async function parseMcpRequestsWebApi(
  config: ATXPConfig,
  request: Request
): Promise<JSONRPCRequest[]> {
  const requestUrl = new URL(request.url);

  try {
    const text = await request.text();
    if (!text) {
      return [];
    }

    const parsedBody = JSON.parse(text);

    // Use the shared core logic
    return parseMcpRequestsCore(config, requestUrl, request.method, parsedBody) as JSONRPCRequest[];
  } catch (error) {
    config.logger.debug(`Error parsing MCP request: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
