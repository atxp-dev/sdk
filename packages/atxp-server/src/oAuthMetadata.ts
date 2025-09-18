import { ATXPConfig } from "./types.js";
import * as oauth from 'oauth4webapi';
import { getPath } from "./getResource.js";

export async function getOAuthMetadata(config: ATXPConfig, requestUrl: URL): Promise<oauth.AuthorizationServer | null> {
  if (isOAuthMetadataRequest(config, requestUrl)) {
    try {
      const authServer = await config.oAuthClient.authorizationServerFromUrl(new URL(config.server));

      return {
        issuer: config.server,
        authorization_endpoint: authServer.authorization_endpoint,
        response_types_supported: authServer.response_types_supported,
        grant_types_supported: authServer.grant_types_supported,
        token_endpoint: authServer.token_endpoint,
        token_endpoint_auth_methods_supported: authServer.token_endpoint_auth_methods_supported,
        registration_endpoint: authServer.registration_endpoint,
        revocation_endpoint: authServer.revocation_endpoint,
        introspection_endpoint: authServer.introspection_endpoint,
        introspection_endpoint_auth_methods_supported: authServer.introspection_endpoint_auth_methods_supported,
        code_challenge_methods_supported: authServer.code_challenge_methods_supported,
        scopes_supported: authServer.scopes_supported
      };
    } catch (error) {
      config.logger.error(`Error fetching authorization server configuration from ${config.server}: ${error}`);
      throw error;
    }
  }
  return null;
}

function isOAuthMetadataRequest(config: ATXPConfig, requestUrl: URL): boolean {
  const path = getPath(requestUrl).replace(/\/$/, '');
  return path === '/.well-known/oauth-authorization-server';
}