import { Request, Response, NextFunction, Router } from "express";
import {
  ATXPArgs,
  buildServerConfig,
  checkTokenNode,
  sendOAuthChallenge,
  withATXPContext,
  parseMcpRequestsNode,
  getProtectedResourceMetadata as getPRMResponse,
  getResource,
  getOAuthMetadata,
  sendProtectedResourceMetadataNode,
  sendOAuthMetadataNode,
  detectProtocol,
  ProtocolSettlement,
  type PaymentProtocol,
  type ATXPConfig,
} from "@atxp/server";

export function atxpExpress(args: ATXPArgs): Router {
  const config = buildServerConfig(args);
  const router = Router();

  // Regular middleware
  const atxpMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logger = config.logger;  // Capture logger in closure
      const requestUrl = new URL(req.url, req.protocol + '://' + req.host);
      logger.debug(`Handling ${req.method} ${requestUrl.toString()}`);

      const resource = getResource(config, requestUrl, req.headers);
      const prmResponse = getPRMResponse(config, requestUrl, req.headers);
      if (sendProtectedResourceMetadataNode(res, prmResponse)) {
        return;
      }

      // Some older clients don't use PRM and assume the MCP server is an OAuth server
      const oAuthMetadata = await getOAuthMetadata(config, requestUrl);
      if(sendOAuthMetadataNode(res, oAuthMetadata)) {
        return;
      }

      const mcpRequests = await parseMcpRequestsNode(config, requestUrl, req, req.body);
      logger.debug(`${mcpRequests.length} MCP requests found in request`);

      if(mcpRequests.length === 0) {
        // For non-MCP requests: check for payment credentials (X402 or ATXP)
        const detected = detectProtocol({
          'x-payment': req.headers['x-payment'] as string | undefined,
          'authorization': req.headers['authorization'] as string | undefined,
        });

        if (detected) {
          // This is a retry with payment credentials — verify and settle
          await handleProtocolCredential(config, req, res, next, detected.protocol, detected.credential);
          return;
        }

        next();
        return;
      }

      logger.debug(`Request started - ${req.method} ${req.path}`);
      const tokenCheck = await checkTokenNode(config, resource, req);
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

/**
 * Handle a request that includes payment credentials (retry after challenge).
 * Verifies the credential at request start, serves the request, then settles at request end.
 */
async function handleProtocolCredential(
  config: ATXPConfig,
  req: Request,
  res: Response,
  next: NextFunction,
  protocol: PaymentProtocol,
  credential: string,
): Promise<void> {
  const logger = config.logger;
  const settlement = new ProtocolSettlement(config.server, logger);

  logger.info(`Detected ${protocol} credential on retry request`);

  // Verify at request START
  const verifyResult = await settlement.verify(protocol, credential);
  if (!verifyResult.valid) {
    logger.warn(`${protocol} credential verification failed`);
    res.status(402).json({ error: 'invalid_payment', error_description: `${protocol} credential verification failed` });
    return;
  }

  logger.info(`${protocol} credential verified successfully`);

  // Listen for response finish to settle at request END
  res.on('finish', async () => {
    try {
      logger.debug(`Request finished, settling ${protocol} payment`);
      await settlement.settle(protocol, credential);
    } catch (error) {
      logger.error(`Failed to settle ${protocol} payment: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Proceed with the request
  next();
}
