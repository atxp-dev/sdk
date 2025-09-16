import { ATXPConfig, TokenCheck, TokenProblem } from "../types.js";

/**
 * Core platform-agnostic token checking logic
 * Takes an authorization header string instead of platform-specific request objects
 */
export async function checkTokenCore(
  config: ATXPConfig,
  resourceURL: URL,
  authorizationHeader: string | null
): Promise<TokenCheck> {
  const protocol = resourceURL.protocol;
  const host = resourceURL.host;
  const pathname = resourceURL.pathname;
  const protectedResourceMetadataUrl = `${protocol}//${host}/.well-known/oauth-protected-resource${pathname}`;

  const failure = {
    passes: false as const,
    resourceMetadataUrl: protectedResourceMetadataUrl,
  };

  // Extract the Bearer token from the Authorization header
  if (!authorizationHeader) {
    return {...failure, problem: TokenProblem.NO_TOKEN, data: null, token: null}
  }
  if (!authorizationHeader.startsWith('Bearer ')) {
    return {...failure, problem: TokenProblem.NON_BEARER_AUTH_HEADER, data: null, token: null}
  }

  const token = authorizationHeader.substring(7);

  try {
    const introspectionResult = await config.oAuthClient.introspectToken(config.server, token);

    if (!introspectionResult.active) {
      return {...failure, problem: TokenProblem.INVALID_TOKEN, data: null, token}
    }

    return {
      passes: true,
      data: introspectionResult,
      token,
    };
  } catch (error) {
    config.logger.error(`Error during token introspection: ${error}`);
    return {...failure, problem: TokenProblem.INTROSPECT_ERROR, data: null, token};
  }
}