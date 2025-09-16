import { TokenCheck, TokenProblem } from "../types.js";

/**
 * Core platform-agnostic OAuth challenge response creation
 * Returns the response data instead of writing to platform-specific response objects
 */
export function createOAuthChallengeResponseCore(tokenCheck: TokenCheck): {
  status: number;
  headers: Record<string, string>;
  body: string;
} | null {
  if (tokenCheck.passes) {
    return null;
  }

  let status = 401;
  let body: {status?: number, error?: string, error_description?: string} = {};

  // https://datatracker.ietf.org/doc/html/rfc6750#section-3.1
  switch (tokenCheck.problem) {
    case TokenProblem.NO_TOKEN:
      break;
    case TokenProblem.NON_BEARER_AUTH_HEADER:
      status = 400;
      body = { error: 'invalid_request', error_description: 'Authorization header did not include a Bearer token' };
      break;
    case TokenProblem.INVALID_TOKEN:
      body = { error: 'invalid_token', error_description: 'Token is not active' };
      break;
    case TokenProblem.INVALID_AUDIENCE:
      body = { error: 'invalid_token', error_description: 'Token does not match the expected audience' };
      break;
    case TokenProblem.NON_SUFFICIENT_FUNDS:
      status = 403;
      body = { error: 'insufficient_scope', error_description: 'Non sufficient funds' };
      break;
    case TokenProblem.INTROSPECT_ERROR:
      status = 502;
      body = { error: 'server_error', error_description: 'An internal server error occurred' };
      break;
    default:
      // Unknown problem
      break;
  }

  const wwwAuthenticate = `Bearer resource_metadata="${tokenCheck.resourceMetadataUrl}"`;

  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': wwwAuthenticate
    },
    body: JSON.stringify(body)
  };
}