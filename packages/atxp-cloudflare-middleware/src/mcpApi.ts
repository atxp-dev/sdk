import { ATXPWorkerMiddleware } from "./workerMiddleware.js";
import { getATXPWorkerContext, atxpAccountId } from "./workerContext.js";
import { buildWorkerATXPConfig } from "./buildConfig.js";
import { ATXPConfig } from "@atxp/server";
import {
  ATXPMcpConfig,
  ATXPAuthContext
} from "./types.js";


/**
 * ATXP API for MCP servers - provides authentication and payment functionality
 */
export class ATXPMcpApi {
  private static middleware: ATXPWorkerMiddleware | null = null;
  private static config: ATXPConfig | null = null;

  /**
   * Initialize ATXP middleware for MCP server
   */
  static init(options: ATXPMcpConfig): void {
    if (!options.fundingDestination) {
      throw new Error('fundingDestination is required for ATXP initialization');
    }
    if (!options.fundingNetwork) {
      throw new Error('fundingNetwork is required for ATXP initialization');
    }

    const atxpArgs = {
      destination: options.fundingDestination,
      network: options.fundingNetwork,
      payeeName: options.payeeName || 'MCP Server',
      allowHttp: options.allowHttp || false,
    };

    // Build config once and reuse it
    ATXPMcpApi.config = buildWorkerATXPConfig(atxpArgs);
    ATXPMcpApi.middleware = new ATXPWorkerMiddleware(ATXPMcpApi.config);
  }

  /**
   * Get the ATXP middleware instance (must call init() first)
   */
  static getMiddleware(): ATXPWorkerMiddleware {
    if (!ATXPMcpApi.middleware) {
      throw new Error('ATXP not initialized - call ATXPMcpApi.init() first');
    }
    return ATXPMcpApi.middleware;
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
   * Create authentication context from ATXP worker context
   * This should be called after ATXP middleware processing
   */
  static createAuthContext(): ATXPAuthContext {
    const atxpWorkerContext = getATXPWorkerContext();

    if (!atxpWorkerContext) {
      return {};
    }

    const {userToken, tokenData} = atxpWorkerContext;
    return {
      user: atxpAccountId() || undefined,
      userToken: userToken || undefined,
      claims: tokenData || undefined,
    };
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
    return ATXPMcpApi.middleware !== null && ATXPMcpApi.config !== null;
  }

  /**
   * Reset ATXP state (useful for testing)
   */
  static reset(): void {
    ATXPMcpApi.middleware = null;
    ATXPMcpApi.config = null;
  }
}