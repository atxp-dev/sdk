import { ATXPConfig, checkTokenWebApi, sendOAuthChallengeWebApi, parseMcpRequestsWebApi } from "@atxp/server";
import { setATXPWorkerContext } from "./workerContext.js";

export class ATXPWorkerMiddleware {
  private config: ATXPConfig;

  constructor(config: ATXPConfig) {
    this.config = config;
  }

  async handleRequest(request: Request): Promise<Response | null> {
    try {
      const logger = this.config.logger;
      const requestUrl = new URL(request.url);
      logger.debug(`ATXP Middleware: Handling ${request.method} ${requestUrl.toString()}`);

      // Create a basic resource URL
      const resource = new URL(requestUrl.origin);

      // Check if this is an MCP request by examining the request
      const clonedRequest = request.clone();
      const isMCPRequest = await parseMcpRequestsWebApi(this.config, clonedRequest);
      logger.debug(`${isMCPRequest.length} MCP requests found in request`);

      // If there are no MCP requests, let the request continue without authentication
      if (isMCPRequest.length === 0) {
        logger.debug('No MCP requests found - letting request continue without ATXP processing');
        return null;
      }

      // Check the token using proper OAuth logic
      const tokenCheck = await checkTokenWebApi(this.config, resource, request);
      const user = tokenCheck.data?.sub ?? null;

      logger.debug(`Token check result: passes=${tokenCheck.passes}, user=${user}`);

      // Send OAuth challenge if needed
      const challengeResponse = sendOAuthChallengeWebApi(tokenCheck);
      if (challengeResponse) {
        logger.debug('Sending OAuth challenge response');
        return challengeResponse;
      }

      // Create and store context for this request using SDK-compatible structure
      setATXPWorkerContext(this.config, resource, tokenCheck);

      // Let the request continue to MCP handling
      return null;

    } catch (error) {
      this.config.logger.error(`Critical error in ATXP middleware: ${error instanceof Error ? error.message : String(error)}`);

      return new Response(JSON.stringify({
        error: 'server_error',
        error_description: 'An internal server error occurred in ATXP middleware'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}