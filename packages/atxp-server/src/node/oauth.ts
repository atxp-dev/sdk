import { ServerResponse } from "http";
import { TokenCheck } from "../types.js";
import { createOAuthChallengeResponseCore } from "../core/oauth.js";

/**
 * Node.js HTTP implementation of OAuth challenge sending
 * Uses Node.js ServerResponse and delegates to core logic
 */
export function sendOAuthChallenge(res: ServerResponse, tokenCheck: TokenCheck): boolean {
  // Use the shared core logic to get response data
  const responseData = createOAuthChallengeResponseCore(tokenCheck);

  if (!responseData) {
    return false;
  }

  // Apply the response data to Node.js ServerResponse
  Object.entries(responseData.headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.writeHead(responseData.status);
  res.end(responseData.body);

  return true;
}