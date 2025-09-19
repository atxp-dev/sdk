/* eslint-disable @typescript-eslint/no-explicit-any */
import { ATXPArgs, TokenCheck } from "@atxp/server";

/**
 * Configuration options for atxpCloudflare function
 */
export interface ATXPCloudflareOptions extends ATXPArgs {
  /** The MCP agent class to wrap */
  mcpAgent: {
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

export type ATXPMCPAgentProps = {
  resource: URL;
  tokenCheck: TokenCheck | null;
}