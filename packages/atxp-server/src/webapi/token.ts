import { ATXPConfig, TokenCheck } from "../types.js";
import { checkTokenCore } from "../core/token.js";

/**
 * Web API implementation of token checking for Cloudflare Workers, Deno, etc.
 * Extracts data from Web API Request and delegates to core logic
 */
export async function checkTokenWebApi(
  config: ATXPConfig,
  resourceURL: URL,
  request: Request
): Promise<TokenCheck> {
  // Extract authorization header from Web API request
  const authorizationHeader = request.headers.get('authorization');

  // Use the shared core logic
  return checkTokenCore(config, resourceURL, authorizationHeader);
}