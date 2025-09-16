import { TokenCheck } from "../types.js";
import { createOAuthChallengeResponseCore } from "../core/oauth.js";

/**
 * Web API implementation of OAuth challenge sending for Cloudflare Workers, Deno, etc.
 * Uses Web API Response and delegates to core logic
 */
export function sendOAuthChallengeWebApi(tokenCheck: TokenCheck): Response | null {
  // Use the shared core logic to get response data
  const responseData = createOAuthChallengeResponseCore(tokenCheck);

  if (!responseData) {
    return null;
  }

  // Convert to Web API Response
  return new Response(responseData.body, {
    status: responseData.status,
    headers: responseData.headers
  });
}