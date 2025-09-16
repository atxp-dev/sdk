import { Request, Response, NextFunction, Router } from "express";
import {
  ATXPConfig,
  ATXPArgs,
  DEFAULT_CONFIG,
  buildServerConfig,
  checkToken,
  sendOAuthChallenge,
  withATXPContext,
  parseMcpRequests,
  getProtectedResourceMetadata as getPRMResponse,
  sendProtectedResourceMetadata,
  getResource,
  getOAuthMetadata,
  sendOAuthMetadata
} from "@atxp/server";

export function atxpExpressMiddleware(args: ATXPArgs): Router {
  const config = buildServerConfig(args);
  const router = Router();

  // Regular middleware
  const atxpMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logger = config.logger;  // Capture logger in closure
      const requestUrl = new URL(req.url, req.protocol + '://' + req.host);
      logger.debug(`Handling ${req.method} ${requestUrl.toString()}`);

      const resource = getResource(config, requestUrl);
      const prmResponse = getPRMResponse(config, requestUrl);
      if (sendProtectedResourceMetadata(res, prmResponse)) {
        return;
      }

      // Some older clients don't use PRM and assume the MCP server is an OAuth server
      const oAuthMetadata = await getOAuthMetadata(config, requestUrl);
      if(sendOAuthMetadata(res, oAuthMetadata)) {
        return;
      }

      const mcpRequests = await parseMcpRequests(config, requestUrl, req, req.body);
      logger.debug(`${mcpRequests.length} MCP requests found in request`);

      if(mcpRequests.length === 0) {
        next();
        return;
      }

      logger.debug(`Request started - ${req.method} ${req.path}`);
      const tokenCheck = await checkToken(config, resource, req);
      const user = tokenCheck.data?.sub ?? null;

      // Listen for when the response is finished
      res.on('finish', async () => {
        logger.debug(`Request finished ${user ? `for user ${user} ` : ''}- ${req.method} ${req.path}`);
      });

      // Send the oauth challenge, if needed. If we do, we're done
      if (sendOAuthChallenge(res, tokenCheck)) {
        return;
      }

      return withATXPContext(config, resource, tokenCheck, next);
    } catch (error) {
      config.logger.error(`Critical error in atxp middleware - returning HTTP 500. Error: ${error instanceof Error ? error.message : String(error)}`);
      config.logger.debug(JSON.stringify(error, null, 2));
      res.status(500).json({ error: 'server_error', error_description: 'An internal server error occurred' });
    }
  };

  // Add middleware to the router
  router.use(atxpMiddleware);

  return router;
}