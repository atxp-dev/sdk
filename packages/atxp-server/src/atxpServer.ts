import { ConsoleLogger, OAuthResourceClient, DEFAULT_AUTHORIZATION_SERVER, MemoryOAuthDb } from "@atxp/common";
import { ATXPConfig, PaymentServer } from "./types.js";
import { checkToken } from "./token.js";
import { sendOAuthChallenge } from "./oAuthChallenge.js";
import { withATXPContext } from "./atxpContext.js";
import { parseMcpRequests } from "./http.js";
import { Request, Response, NextFunction, Router } from "express";
import { getProtectedResourceMetadata as getPRMResponse, sendProtectedResourceMetadata } from "./protectedResourceMetadata.js";
import { getResource } from "./getResource.js";
import { ATXPPaymentServer } from "./paymentServer.js";
import { getOAuthMetadata, sendOAuthMetadata } from "./oAuthMetadata.js";

type RequiredATXPConfigFields = 'destination';
type RequiredATXPConfig = Pick<ATXPConfig, RequiredATXPConfigFields>;
type OptionalATXPConfig = Omit<ATXPConfig, RequiredATXPConfigFields>;
export type ATXPArgs = RequiredATXPConfig & Partial<OptionalATXPConfig>;
type BuildableATXPConfigFields = 'oAuthDb' | 'oAuthClient' | 'paymentServer' | 'logger';

export const DEFAULT_CONFIG: Required<Omit<OptionalATXPConfig, BuildableATXPConfigFields>> = {
  mountPath: '/',
  currency: 'USDC' as const,
  network: 'solana' as const,
  server: DEFAULT_AUTHORIZATION_SERVER,
  atxpAuthClientToken: undefined as string|undefined, // Will be set in buildServerConfig
  payeeName: 'An ATXP Server',
  allowHttp: false, // May be overridden in buildServerConfig by process.env.NODE_ENV
  resource: null, // Set dynamically from the request URL
};

export function buildServerConfig(args: ATXPArgs): ATXPConfig {
  if(!args.destination) {
    throw new Error('destination is required');
  }

  // Read environment variables at runtime, not module load time
  const envDefaults = {
    ...DEFAULT_CONFIG,
    atxpAuthClientToken: process.env.ATXP_AUTH_CLIENT_TOKEN,
    allowHttp: process.env.NODE_ENV === 'development',
  };
  const withDefaults = { ...envDefaults, ...args };
  const oAuthDb = withDefaults.oAuthDb ?? new MemoryOAuthDb()
  const oAuthClient = withDefaults.oAuthClient ?? new OAuthResourceClient({
    db: oAuthDb,
    allowInsecureRequests: withDefaults.allowHttp,
    clientName: withDefaults.payeeName,
  });
  const logger = withDefaults.logger ?? new ConsoleLogger();
  let paymentServer: PaymentServer | undefined;
  if (withDefaults.paymentServer ) {
    paymentServer = withDefaults.paymentServer;
  } else {
    if (!withDefaults.atxpAuthClientToken) {
      throw new Error('ATXP_AUTH_CLIENT_TOKEN is not set. If no payment server is provided, you must set ATXP_AUTH_CLIENT_TOKEN.');
    }
    paymentServer = new ATXPPaymentServer(withDefaults.server, withDefaults.atxpAuthClientToken, logger);
  }
  const built = { oAuthDb, oAuthClient, paymentServer, logger};
  return Object.freeze({ ...withDefaults, ...built });
};

export function atxpServer(args: ATXPArgs): Router {
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