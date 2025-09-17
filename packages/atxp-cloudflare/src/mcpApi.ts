/**
 * ATXP API for MCP servers - provides authentication and payment functionality
 */
export class ATXPMcpApi {
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
}