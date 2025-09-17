import { ATXPConfig, ProtectedResourceMetadata } from "./types.js";
import { getPath, getResource } from "./getResource.js";

export function getProtectedResourceMetadata(config: ATXPConfig, requestUrl: URL, headers?: Record<string, string | string[] | undefined>): ProtectedResourceMetadata | null {
  if (isProtectedResourceMetadataRequest(config, requestUrl, headers)) {
    const resource = getResource(config, requestUrl, headers);
    return {
      resource,
      resource_name: config.payeeName || resource.toString(),
      authorization_servers: [config.server],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    };
  }
  return null;
}

function isProtectedResourceMetadataRequest(config: ATXPConfig, requestUrl: URL, headers?: Record<string, string | string[] | undefined>): boolean {
  const path = getPath(requestUrl);
  if (!path.startsWith('/.well-known/oauth-protected-resource')) {
    return false;
  }
  const resource = getResource(config, requestUrl, headers);
  const resourcePath = getPath(resource);
  const mountPath = config.mountPath.replace(/\/$/, '');
  if (resourcePath === mountPath) {
    return true;
  }
  if (resourcePath === `${mountPath}/message`) {
    return true;
  }
  return false;
}