import { ProtectedResourceMetadata, TokenCheck } from "../types.js";
import { createOAuthChallengeResponseCore } from "../core/oauth.js";
import * as oauth from 'oauth4webapi';

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

export function sendProtectedResourceMetadata(metadata: ProtectedResourceMetadata | null): Response | null {
  if (!metadata) {
    return null;
  }

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export function sendOAuthMetadata(metadata: oauth.AuthorizationServer | null): Response | null {
  if (!metadata) {
    return null;
  }
  
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}