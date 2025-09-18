import { ATXPConfig } from "./types.js";

export function getPath(url: URL): string {
  const fullPath = url.pathname.replace(/^\/$/, '');
  return fullPath;
}

function getProtocolFromHeaders(headers: Record<string, string | string[] | undefined>, requestProtocol: string): string {
  // Check for X-Forwarded-Proto header (common proxy header)
  const forwardedProto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'];
  if (forwardedProto) {
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    return proto === 'https' ? 'https:' : 'http:';
  }

  // Check for X-Forwarded-Protocol header (alternative)
  const forwardedProtocol = headers['x-forwarded-protocol'] || headers['X-Forwarded-Protocol'];
  if (forwardedProtocol) {
    const proto = Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol;
    return proto === 'https' ? 'https:' : 'http:';
  }

  // Fall back to request protocol
  return requestProtocol;
}

export function getResource(config: ATXPConfig, requestUrl: URL, headers?: Record<string, string | string[] | undefined>): URL {
  if (config.resource) {
    return new URL(config.resource);
  }

  const originalProtocol = headers ? getProtocolFromHeaders(headers, requestUrl.protocol) : requestUrl.protocol;
  const protocol = config.allowHttp ? originalProtocol : 'https:';
  const url = new URL(`${protocol}//${requestUrl.host}${requestUrl.pathname}`);

  const fullPath = getPath(url);
  // If this is a PRM path, convert it into the path for the resource this is the metadata for
  const resourcePath = fullPath.replace('/.well-known/oauth-protected-resource', '').replace(/\/$/, '');

  const resource = new URL(`${protocol}//${requestUrl.host}${resourcePath}`);
  return resource;
}