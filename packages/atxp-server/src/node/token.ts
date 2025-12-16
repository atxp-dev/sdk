import { IncomingMessage } from "http";
import { ATXPConfig, TokenCheck } from "../types.js";
import { checkTokenCore } from "../core/token.js";

/**
 * Extracts the authorization header from request, with fallback to X-ATXP-Token header.
 * Some proxies (like Daytona) may intercept the Authorization header, so we support
 * an alternative header as a fallback.
 */
function getAuthorizationHeader(req: IncomingMessage): string | null {
  // First, try the standard Authorization header
  if (req.headers.authorization) {
    return req.headers.authorization;
  }

  // Fallback: check for X-ATXP-Token header and convert to Bearer format
  const atxpToken = req.headers['x-atxp-token'];
  if (atxpToken) {
    // Handle array case (multiple headers) - use first value
    const token = Array.isArray(atxpToken) ? atxpToken[0] : atxpToken;
    return `Bearer ${token}`;
  }

  return null;
}

/**
 * Node.js HTTP implementation of token checking
 * Extracts data from Node.js IncomingMessage and delegates to core logic
 */
export async function checkToken(config: ATXPConfig, resourceURL: URL, req: IncomingMessage): Promise<TokenCheck> {
  // Extract the authorization header from Node.js request (with fallback)
  const authorizationHeader = getAuthorizationHeader(req);

  // Use the shared core logic
  return checkTokenCore(config, resourceURL, authorizationHeader);
}