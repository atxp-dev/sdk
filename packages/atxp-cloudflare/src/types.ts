/* eslint-disable @typescript-eslint/no-explicit-any */
import { ATXPArgs } from "@atxp/server";

/**
 * Authentication context type for ATXP integration with MCP servers
 */
export interface ATXPAuthContext {
  user?: string;
  userToken?: string;
  claims?: {
    sub?: string;
    [key: string]: unknown;
  };
  atxpInitParams?: ATXPArgs;  // Pass ATXP initialization params to Durable Object
  [key: string]: unknown;
}

/**
 * Environment interface for Cloudflare Workers with ATXP configuration
 */
export interface ATXPEnv {
  FUNDING_DESTINATION?: string;
  FUNDING_NETWORK?: string;
  ALLOW_INSECURE_HTTP_REQUESTS_DEV_ONLY_PLEASE?: string;
}

/**
 * Configuration options for atxpCloudflare function
 */
export interface ATXPCloudflareOptions extends ATXPArgs {
  /** The MCP agent class to wrap */
  mcpAgent: {
    new (ctx: any, env: any): any;
    serve(path: string): any;
    serveSSE(path: string): any;
  };
  /** Mount paths for MCP endpoints */
  mountPaths?: {
    mcp?: string;
    sse?: string;
    root?: string;
  };
}

/**
 * Cloudflare Workers ATXP handler function - similar to atxpServer but for Workers
 */
export interface ATXPCloudflareWorkerHandler {
  (request: Request, env: unknown, ctx: {[key: string]: unknown}): Promise<Response | null>;
}