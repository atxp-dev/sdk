import { IncomingMessage } from "http";
import { ATXPConfig, TokenCheck } from "../types.js";
import { checkTokenCore } from "../core/token.js";

/**
 * Node.js HTTP implementation of token checking
 * Extracts data from Node.js IncomingMessage and delegates to core logic
 */
export async function checkToken(config: ATXPConfig, resourceURL: URL, req: IncomingMessage): Promise<TokenCheck> {
  // Extract the authorization header from Node.js request
  const authorizationHeader = req.headers.authorization || null;

  // Use the shared core logic
  return checkTokenCore(config, resourceURL, authorizationHeader);
}