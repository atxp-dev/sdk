import { ConsoleLogger, OAuthResourceClient, DEFAULT_AUTHORIZATION_SERVER, MemoryOAuthDb } from "@atxp/common";
import { ATXPConfig } from "./types.js";
import { ATXPPaymentServer } from "./paymentServer.js";

type RequiredATXPConfigFields = 'destinations';
type RequiredATXPConfig = Pick<ATXPConfig, RequiredATXPConfigFields>;
type OptionalATXPConfig = Omit<ATXPConfig, RequiredATXPConfigFields>;
export type ATXPArgs = RequiredATXPConfig & Partial<OptionalATXPConfig>;
type BuildableATXPConfigFields = 'oAuthDb' | 'oAuthClient' | 'paymentServer' | 'logger' | 'minimumPayment';

export const DEFAULT_CONFIG: Required<Omit<OptionalATXPConfig, BuildableATXPConfigFields>> = {
  mountPath: '/',
  currency: 'USDC' as const,
  server: DEFAULT_AUTHORIZATION_SERVER,
  payeeName: 'An ATXP Server',
  allowHttp: false, // May be overridden in buildServerConfig by process.env.NODE_ENV
  resource: null, // Set dynamically from the request URL
};

export function buildServerConfig(args: ATXPArgs): ATXPConfig {
  if(!args.destinations || args.destinations.length === 0) {
    throw new Error('destinations array is required and must not be empty');
  }

  for (const dest of args.destinations) {
    if (!dest.network || typeof dest.network !== 'string') {
      throw new Error('Each destination must have a network field');
    }
    if (!dest.address || typeof dest.address !== 'string') {
      throw new Error('Each destination must have an address field');
    }
  }

  // Validate minimumPayment if provided
  if (args.minimumPayment && args.minimumPayment.isGreaterThan(1)) {
    throw new Error('minimumPayment cannot exceed $1.00');
  }

  // Read environment variables at runtime, not module load time
  const envDefaults = {
    ...DEFAULT_CONFIG,
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
