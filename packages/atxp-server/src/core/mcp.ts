import { ATXPConfig } from "../types.js";

/**
 * Core platform-agnostic MCP request parsing logic
 * Takes parsed JSON and request metadata instead of platform-specific request objects
 */
export function parseMcpRequestsCore(
  config: ATXPConfig,
  requestUrl: URL,
  method: string,
  parsedBody: unknown
): unknown[] {
  if (!method || method.toLowerCase() !== 'post') {
    return [];
  }

  // The middleware has to be mounted at the root to serve the protected resource metadata,
  // but the actual MCP server it's controlling is specified by the mountPath.
  const path = requestUrl.pathname.replace(/\/$/, '');
  const mountPath = config.mountPath.replace(/\/$/, '');
  if (path !== mountPath && path !== `${mountPath}/message`) {
    config.logger.debug(`Request path (${path}) does not match the mountPath (${mountPath}), skipping MCP middleware`);
    return [];
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    return [];
  }

  // Check if it's a JSON-RPC request
  if (Array.isArray(parsedBody)) {
    // Batch request
    return parsedBody.filter(msg =>
      msg && typeof msg === 'object' &&
      msg.jsonrpc === '2.0' &&
      msg.method &&
      msg.id !== undefined
    );
  } else {
    // Single request
    const body = parsedBody as {jsonrpc?: string, method?: string, id?: unknown};
    if (body.jsonrpc === '2.0' && body.method && body.id !== undefined) {
      return [body];
    }
  }

  return [];
}