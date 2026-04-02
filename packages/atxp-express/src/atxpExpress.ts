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
  // Single ProtocolSettlement instance shared across all requests (stateless, just holds config)
  const settlement = new ProtocolSettlement(config.server, config.logger);

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
          await handleProtocolCredential(config, settlement, req, res, next, detected.protocol, detected.credential);
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
    } catch (error) {
      // Bearer token present but check failed — likely a config problem (wrong issuer, JWKS
      // unreachable, etc.), not just a missing token. Log at warn to surface it.
      logger.warn(`Failed to resolve identity from OAuth token, falling back to credential: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Fallback: extract identity from the MPP credential's source field.
  // Standard MPP uses a DID string: "did:pkh:eip155:<chainId>:<address>"
  if (protocol === 'mpp') {
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(Buffer.from(credential, 'base64').toString());
      } catch {
        parsed = JSON.parse(credential);
      }
      const source = parsed.source;
      if (typeof source === 'string' && source.startsWith('did:pkh:eip155:')) {
        // Extract chain ID and address from DID: did:pkh:eip155:<chainId>:<address>
        const parts = source.split(':');
        const chainId = parts[3];
        const address = parts[4];
        if (chainId && address) {
          // Map chainId to network name for our AccountId format
          const network = chainId === '4217' ? 'tempo' : chainId === '42431' ? 'tempo_moderato' : `eip155:${chainId}`;
          const identity = `${network}:${address}`;
          logger.debug(`Resolved identity from MPP credential source DID: ${identity}`);
          return identity;
        }
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
  settlement: ProtocolSettlement,
  req: Request,
  res: Response,
  next: NextFunction,
  protocol: PaymentProtocol,
  credential: string,
): Promise<void> {
  const logger = config.logger;

  logger.info(`Detected ${protocol} credential on retry request`);

  // Resolve user identity before verification
  const sourceAccountId = await resolveIdentity(config, req, protocol, credential);
  if (sourceAccountId) {
    logger.debug(`Resolved identity for ${protocol} payment: ${sourceAccountId}`);
  }

  // Build context with identity — passed to both verify and settle so auth
  // can use sourceAccountId for account-level checks (rate limiting, spend limits)
  // during verification, and for payment recording during settlement.
  const context: SettlementContext = {
    ...(sourceAccountId && { sourceAccountId }),
  };

  // Verify at request START.
  // Note: for X402, context.paymentRequirements is not available here because the
  // middleware doesn't have the original 402 challenge data from the previous request.
  // Auth handles undefined paymentRequirements gracefully (Coinbase facilitator can
  // verify Permit2 signatures without them).
  let verifyResult;
  try {
    verifyResult = await settlement.verify(protocol, credential, context);
  } catch (error) {
    logger.warn(`${protocol} credential parsing/verification error: ${error instanceof Error ? error.message : String(error)}`);
    res.status(400).json({ error: 'invalid_payment', error_description: `Malformed ${protocol} credential` });
    return;
  }
  if (!verifyResult.valid) {
    logger.warn(`${protocol} credential verification failed`);
    res.status(402).json({ error: 'invalid_payment', error_description: `${protocol} credential verification failed` });
    return;
  }

  logger.info(`${protocol} credential verified successfully`);

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
