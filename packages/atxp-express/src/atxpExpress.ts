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
  setDetectedCredential,
  type PaymentProtocol,
  type ATXPConfig,
} from "@atxp/server";

export function atxpExpress(args: ATXPArgs): Router {
  const config = buildServerConfig(args);
  const router = Router();

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

      // Detect payment credentials from request headers.
      // The credential is stored in ATXP context for requirePayment() to settle
      // with full pricing context (amount, options, destination).
      const detected = detectProtocol({
        'x-atxp-payment': req.headers['x-atxp-payment'] as string | undefined,
        'x-payment': req.headers['x-payment'] as string | undefined,
        'authorization': req.headers['authorization'] as string | undefined,
      });

      if (mcpRequests.length === 0) {
        // Non-MCP request with credential: for REST APIs, the route handler
        // is responsible for checking payment (not requirePayment).
        // TODO: Support settle-in-handler for non-MCP REST APIs.
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

      // Set up ATXP context, then store detected credential if present.
      // requirePayment() will find it via getDetectedCredential() and settle
      // before charging, using the pricing context it has (amount, options).
      return withATXPContext(config, resource, tokenCheck, () => {
        if (detected) {
          const sourceAccountId = resolveIdentitySync(config, req, detected.protocol, detected.credential);
          setDetectedCredential({
            protocol: detected.protocol,
            credential: detected.credential,
            sourceAccountId,
          });
          logger.info(`Stored ${detected.protocol} credential in context for requirePayment`);
        }
        return next();
      });
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
 * Synchronous identity resolution from request headers/credential.
 *
 * Priority:
 * 1. ATXP credential sourceAccountId
 * 2. MPP credential source DID
 * 3. X402: not available until after settlement
 */
function resolveIdentitySync(
  config: ATXPConfig,
  req: Request,
  protocol: PaymentProtocol,
  credential: string,
): string | undefined {
  if (protocol === 'atxp') {
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(Buffer.from(credential, 'base64').toString());
      } catch {
        parsed = JSON.parse(credential);
      }
      if (parsed.sourceAccountId) return parsed.sourceAccountId as string;
    } catch { /* not parseable */ }
  }

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
          return `${network}:${address}`;
        }
      }
    } catch { /* not parseable */ }
  }

  return undefined;
}
