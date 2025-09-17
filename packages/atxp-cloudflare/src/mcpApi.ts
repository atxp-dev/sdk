import { buildATXPConfig } from "./buildATXPConfig.js";
import { ATXPConfig, ATXPArgs } from "@atxp/server";

/**
 * ATXP API for MCP servers - provides authentication and payment functionality
 */
export class ATXPMcpApi {
  private static config: ATXPConfig | null = null;

  /**
   * Initialize ATXP middleware for MCP server
   */
  static init(options: ATXPArgs): void {
    if (!options.destination) {
      throw new Error('destination is required for ATXP initialization');
    }

    // Build config once and reuse it
    ATXPMcpApi.config = buildATXPConfig(options);
  }

  /**
   * Get the ATXP configuration (must call init() first)
   */
  static getConfig(): ATXPConfig {
    if (!ATXPMcpApi.config) {
      throw new Error('ATXP not initialized - call ATXPMcpApi.init() first');
    }
    return ATXPMcpApi.config;
  }

  /**
   * Create OAuth metadata response for the resource
   */
  static createOAuthMetadata(resourceUrl: string, resourceName?: string): Response {
    const metadata = {
      resource: resourceUrl,
      resource_name: resourceName || "ATXP MCP Server",
      authorization_servers: ["https://auth.atxp.ai"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["read", "write"],
    };

    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  /**
   * Check if ATXP is initialized
   */
  static isInitialized(): boolean {
    return ATXPMcpApi.config !== null;
  }

  /**
   * Reset ATXP state (useful for testing)
   */
  static reset(): void {
    ATXPMcpApi.config = null;
  }
}