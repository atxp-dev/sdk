import { ATXPConfig, TokenCheck } from "@atxp/server";

// Use the same context structure as the SDK but with global storage
// since Cloudflare Workers don't support AsyncLocalStorage
type ATXPWorkerContextType = {
  config: ATXPConfig;
  resource: URL;
  tokenCheck: TokenCheck | null;
}

// Simple global context storage for Cloudflare Workers
// Since each Worker handles one request at a time, this is safe
let currentContext: ATXPWorkerContextType | null = null;

export function setATXPWorkerContext(config: ATXPConfig, resource: URL, tokenCheck?: TokenCheck): void {
  currentContext = {
    config,
    tokenCheck: tokenCheck ?? null,
    resource,
  };
}

export function getATXPWorkerContext(): ATXPWorkerContextType | null {
  return currentContext;
}