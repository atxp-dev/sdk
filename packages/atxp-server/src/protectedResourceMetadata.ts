import { ATXPConfig, ProtectedResourceMetadata } from "./types.js";
import { ServerResponse } from "http";
import { getPath, getResource } from "./getResource.js";

export function sendProtectedResourceMetadata(res: ServerResponse, metadata: ProtectedResourceMetadata | null): boolean {
  if (!metadata) {
    return false;
  }
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(metadata));
  return true;
}

export function getProtectedResourceMetadata(config: ATXPConfig, requestUrl: URL): ProtectedResourceMetadata | null {
  if (isProtectedResourceMetadataRequest(config, requestUrl)) {
    const resource = getResource(config, requestUrl);
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

function isProtectedResourceMetadataRequest(config: ATXPConfig, requestUrl: URL): boolean {
  const path = getPath(requestUrl);
  if (!path.startsWith('/.well-known/oauth-protected-resource')) {
    return false;
  }
  const resource = getResource(config, requestUrl);
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