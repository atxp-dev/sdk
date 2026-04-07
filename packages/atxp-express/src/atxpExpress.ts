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

  // Lazy-init ProtocolSettlement with destinationAccountId (requires async resolution).
  // Cache the promise (not the result) to avoid a race where concurrent requests
  // both see _settlement === null and kick off parallel getAccountId() calls.
  let _settlementPromise: Promise<ProtocolSettlement> | null = null;
  async function getSettlement(): Promise<ProtocolSettlement> {
    if (!_settlementPromise) {
      _settlementPromise = (async () => {
        let destinationAccountId: string | undefined;
        try {
          destinationAccountId = await config.destination.getAccountId();
        } catch {
          config.logger.warn('Could not resolve destinationAccountId for ProtocolSettlement');
        }
        return new ProtocolSettlement(config.server, config.logger, fetch.bind(globalThis), destinationAccountId);
      })();
    }
    return _settlementPromise;
  }

  const atxpMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logger = config.logger;
      const requestUrl = new URL(req.url, req.protocol + '://' + req.host);
      logger.debug(`Handling ${req.method} ${requestUrl.toString()}`);

      const resource = getResource(config, requestUrl, req.headers);
      const prmResponse = getPRMResponse(config, requestUrl, req.headers);
      if (sendProtectedResourceMetadataNode(res, prmResponse)) {
        return;
      }

      const oAuthMetadata = await getOAuthMetadata(config, requestUrl);
      if(sendOAuthMetadataNode(res, oAuthMetadata)) {
        return;
      }

      const mcpRequests = await parseMcpRequestsNode(config, requestUrl, req, req.body);
      logger.debug(`${mcpRequests.length} MCP requests found in request`);

      // Detect payment credentials BEFORE the MCP/non-MCP branch.
      // This allows X402/MPP/ATXP credentials to work on both MCP and non-MCP requests.
      const detected = detectProtocol({
        'x-atxp-payment': req.headers['x-atxp-payment'] as string | undefined,
        'x-payment': req.headers['x-payment'] as string | undefined,
        'authorization': req.headers['authorization'] as string | undefined,
      });

      if (detected) {
        // Settle at request start: validate → credit ledger → proceed
        const settlement = await getSettlement();
        const settled = await settleAtRequestStart(config, settlement, req, res, detected.protocol, detected.credential);
        if (!settled) return; // settle returned an error response

        if (mcpRequests.length > 0) {
          // MCP request with credential: run MCP handler (requirePayment will charge from credited ledger)
          logger.debug('Request started with protocol credential - MCP flow');
          const tokenCheck = await checkTokenNode(config, resource, req);
          if (sendOAuthChallenge(res, tokenCheck)) return;
          return withATXPContext(config, resource, tokenCheck, next);
        } else {
          // Non-MCP request with credential: just proceed
          next();
          return;
        }
      }

      // No credential detected — normal flow
      if (mcpRequests.length === 0) {
        next();
        return;
      }

      logger.debug(`Request started - ${req.method} ${req.path}`);
      const tokenCheck = await checkTokenNode(config, resource, req);
      const user = tokenCheck.data?.sub ?? null;

      res.on('finish', async () => {
        logger.debug(`Request finished ${user ? `for user ${user} ` : ''}- ${req.method} ${req.path}`);
      });

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

  router.use(atxpMiddleware);
  return router;
}

/**
 * Resolve the user's identity from the request.
 *
 * Priority:
 * 1. OAuth Bearer token → extract `sub` claim (preferred)
 * 2. Wallet address from payment credential (fallback for non-OAuth clients)
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
      logger.warn(`Failed to resolve identity from OAuth token, falling back to credential: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Fallback: extract identity from the MPP credential's source field
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
        const parts = source.split(':');
        const chainId = parts[3];
        const address = parts[4];
        if (chainId && address) {
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

  // ATXP: identity comes from the credential's sourceAccountId field
  if (protocol === 'atxp') {
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(Buffer.from(credential, 'base64').toString());
      } catch {
        parsed = JSON.parse(credential);
      }
      if (parsed.sourceAccountId) {
        logger.debug(`Resolved identity from ATXP credential: ${parsed.sourceAccountId}`);
        return parsed.sourceAccountId as string;
      }
    } catch {
      // Not parseable
    }
  }

  return undefined;
}

/**
 * Settle a payment credential at the START of a request.
 *
 * Calls auth /settle/{protocol} which:
 * 1. Validates the credential
 * 2. Credits the local balance ledger immediately
 * 3. Fires on-chain settlement async
 *
 * After this returns true, the ledger has been credited and requirePayment()
 * will be able to charge from it.
 *
 * Returns true if settlement succeeded (request should continue),
 * false if it failed (error response already sent).
 *
 * NOTE: Settle-at-start means the payment is committed before the MCP handler runs.
 * If the MCP handler fails after settlement, the user paid for nothing.
 * This is the inverse of the old settle-on-finish problem (user gets resource for free
 * if settlement fails). Settle-at-start is preferred because:
 * 1. Pre-signed credentials (X402 Permit2, MPP signed tx) will settle regardless
 * 2. The ledger credit is for future requests too, not just this one
 * 3. A refund mechanism can be added later; preventing free resource access is harder
 */
async function settleAtRequestStart(
  config: ATXPConfig,
  settlement: ProtocolSettlement,
  req: Request,
  res: Response,
  protocol: PaymentProtocol,
  credential: string,
): Promise<boolean> {
  const logger = config.logger;
  logger.info(`Settling ${protocol} credential at request start`);

  const sourceAccountId = await resolveIdentity(config, req, protocol, credential);
  if (sourceAccountId) {
    logger.debug(`Resolved identity for ${protocol} settlement: ${sourceAccountId}`);
  }

  const context: SettlementContext = {
    ...(sourceAccountId && { sourceAccountId }),
  };

  try {
    const result = await settlement.settle(protocol, credential, context);
    logger.info(`${protocol} settle-at-start succeeded: txHash=${result.txHash}, amount=${result.settledAmount}`);
    return true;
  } catch (error) {
    logger.warn(`${protocol} settle-at-start failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(402).json({
      error: 'settlement_failed',
      error_description: `${protocol} credential settlement failed`,
    });
    return false;
  }
}
