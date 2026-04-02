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
  type SettlementContext,
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
        // For non-MCP requests: check for payment credentials (X402 or MPP)
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
 * Resolve the user's identity from the request.
 *
 * Priority:
 * 1. OAuth Bearer token → extract `sub` claim (preferred — works for all requests)
 * 2. Wallet address from payment credential (fallback for non-OAuth clients)
 *
 * For X402: Authorization: Bearer coexists with X-PAYMENT, so OAuth is available.
 * For MPP: Authorization: Payment replaces Authorization: Bearer. In MCP transport,
 *   identity is maintained via the session. In HTTP transport, the server embeds a
 *   session reference in the MPP challenge `id` field (opaque to the client).
 */
async function resolveIdentity(
  config: ATXPConfig,
  req: Request,
  protocol: PaymentProtocol,
  credential: string,
): Promise<string | undefined> {
  const logger = config.logger;

  // Try OAuth Bearer token first (works when Authorization header isn't used by the payment protocol)
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const resource = getResource(config, new URL(req.url, req.protocol + '://' + req.host), req.headers);
      const tokenCheck = await checkTokenNode(config, resource, req);
      if (tokenCheck.data?.sub) {
        logger.debug(`Resolved identity from OAuth token: ${tokenCheck.data.sub}`);
        return tokenCheck.data.sub;
      }
    } catch {
      logger.debug('Failed to resolve identity from OAuth token, falling back to credential');
    }
  }

  // Fallback: extract wallet address from the payment credential
  if (protocol === 'mpp') {
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(Buffer.from(credential, 'base64').toString());
      } catch {
        parsed = JSON.parse(credential);
      }
      const source = parsed.source as Record<string, string> | undefined;
      if (source?.chain && source?.address) {
        const identity = `${source.chain}:${source.address}`;
        logger.debug(`Resolved identity from MPP credential wallet: ${identity}`);
        return identity;
      }
    } catch {
      // Not parseable — no identity
    }
  }

  // X402: payer address is only available after settlement (facilitator returns it).
  // We can't extract it from the credential pre-settlement. Identity will be
  // resolved by auth from the Permit2 signature if no sourceAccountId is provided.

  return undefined;
}

/**
 * Handle a request that includes payment credentials (retry after challenge).
 * Verifies the credential at request start, serves the request, then settles at request end.
 *
 * Identity resolution: extracts user identity from OAuth token (preferred) or
 * wallet address in payment credential (fallback), and passes it to auth as
 * sourceAccountId for payment recording/reconciliation.
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

  // Resolve user identity before verification
  const sourceAccountId = await resolveIdentity(config, req, protocol, credential);
  if (sourceAccountId) {
    logger.info(`Resolved identity for ${protocol} payment: ${sourceAccountId}`);
  }

  // Verify at request START
  const verifyResult = await settlement.verify(protocol, credential);
  if (!verifyResult.valid) {
    logger.warn(`${protocol} credential verification failed`);
    res.status(402).json({ error: 'invalid_payment', error_description: `${protocol} credential verification failed` });
    return;
  }

  logger.info(`${protocol} credential verified successfully`);

  // Build settlement context with identity for reconciliation
  const context: SettlementContext = {
    ...(sourceAccountId && { sourceAccountId }),
  };

  // Listen for response finish to settle at request END (only on success)
  res.on('finish', async () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        logger.debug(`Request finished successfully (${res.statusCode}), settling ${protocol} payment`);
        await settlement.settle(protocol, credential, context);
      } catch (error) {
        logger.error(`Failed to settle ${protocol} payment: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      logger.info(`Request finished with status ${res.statusCode}, skipping ${protocol} settlement`);
    }
  });

  // Proceed with the request
  next();
}
