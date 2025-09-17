import { ATXPConfig, ATXPArgs, buildServerConfig } from "@atxp/server";

/**
 * Build configuration for Cloudflare Workers
 */
export function buildWorkerATXPConfig(args: ATXPArgs): ATXPConfig {
  // Override the global fetch to fix Cloudflare Workers context issues
  if (typeof globalThis.fetch !== 'undefined') {
    // Store original fetch in case we need it
    const originalFetch = globalThis.fetch;

    // Override global fetch with properly bound version
    // This ensures that internal ATXP HTTP requests work correctly in Cloudflare Workers
    globalThis.fetch = originalFetch.bind(globalThis);
  }
  return buildServerConfig(args);
}