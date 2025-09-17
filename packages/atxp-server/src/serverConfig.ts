import { ConsoleLogger, OAuthResourceClient, DEFAULT_AUTHORIZATION_SERVER, MemoryOAuthDb } from "@atxp/common";
import { ATXPConfig } from "./types.js";
import { ATXPPaymentServer } from "./paymentServer.js";

type RequiredATXPConfigFields = 'paymentDestination';
type RequiredATXPConfig = Pick<ATXPConfig, RequiredATXPConfigFields>;
type OptionalATXPConfig = Omit<ATXPConfig, RequiredATXPConfigFields>;
export type ATXPArgs = RequiredATXPConfig & Partial<OptionalATXPConfig>;
type BuildableATXPConfigFields = 'oAuthDb' | 'oAuthClient' | 'paymentServer' | 'logger';

export const DEFAULT_CONFIG: Required<Omit<OptionalATXPConfig, BuildableATXPConfigFields>> = {
  mountPath: '/',
  currency: 'USDC' as const,
  server: DEFAULT_AUTHORIZATION_SERVER,
  payeeName: 'An ATXP Server',
  allowHttp: false, // May be overridden in buildServerConfig by process.env.NODE_ENV
  resource: null, // Set dynamically from the request URL
};

export function buildServerConfig(args: ATXPArgs): ATXPConfig {
  if(!args.paymentDestination) {
    throw new Error('paymentDestination is required');
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
  const paymentServer = withDefaults.paymentServer ?? new ATXPPaymentServer(withDefaults.server, logger)

  const built = { oAuthDb, oAuthClient, paymentServer, logger};
  return Object.freeze({ ...withDefaults, ...built });
};