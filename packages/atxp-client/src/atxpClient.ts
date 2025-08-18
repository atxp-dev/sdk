import { ClientConfig } from "./types.js";
import { MemoryOAuthDb, ConsoleLogger, DEFAULT_AUTHORIZATION_SERVER } from "@atxp/common";
import { ATXPFetcher } from "./atxpFetcher.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type RequiredClientConfigFields = 'mcpServer' | 'account';
type RequiredClientConfig = Pick<ClientConfig, RequiredClientConfigFields>;
type OptionalClientConfig = Omit<ClientConfig, RequiredClientConfigFields>;
export type ClientArgs = RequiredClientConfig & Partial<OptionalClientConfig>;
type BuildableClientConfigFields = 'oAuthDb' | 'logger';

export const DEFAULT_CLIENT_CONFIG: Required<Omit<OptionalClientConfig, BuildableClientConfigFields>> = {
  allowedAuthorizationServers: [DEFAULT_AUTHORIZATION_SERVER],
  approvePayment: async (_p) => true,
  fetchFn: fetch,
  oAuthChannelFetch: fetch,
  allowHttp: false, // may be overridden in buildClientConfig by process.env.NODE_ENV
  clientInfo: {
    name: 'ATXPClient',
    version: '0.0.1'
  },
  clientOptions: {
    capabilities: {}
  },
  onAuthorize: async () => {},
  onAuthorizeFailure: async () => {},
  onPayment: async () => {},
  onPaymentFailure: async () => {}
};

export function buildClientConfig(args: ClientArgs): ClientConfig {
  // Use fetchFn for oAuthChannelFetch if the latter isn't explicitly set
  if (args.fetchFn && !args.oAuthChannelFetch) {
    args.oAuthChannelFetch = args.fetchFn;
  }
  // Read environment variable at runtime, not module load time
  const envDefaults = {
    ...DEFAULT_CLIENT_CONFIG,
    allowHttp: process.env.NODE_ENV === 'development',
  };
  const withDefaults = { ...envDefaults, ...args };
  const logger = withDefaults.logger ?? new ConsoleLogger();
  const oAuthDb = withDefaults.oAuthDb ?? new MemoryOAuthDb({logger});
  const built = { oAuthDb, logger};
  return Object.freeze({ ...withDefaults, ...built });
};

export function buildStreamableTransport(args: ClientArgs): StreamableHTTPClientTransport {
  const config = buildClientConfig(args);

  const fetcher = new ATXPFetcher({
    accountId: args.account.accountId,
    db: config.oAuthDb,
    paymentMakers: args.account.paymentMakers,
    fetchFn: config.fetchFn,
    sideChannelFetch: config.oAuthChannelFetch,
    allowInsecureRequests: config.allowHttp,
    allowedAuthorizationServers: config.allowedAuthorizationServers,
    approvePayment: config.approvePayment,
    logger: config.logger,
    onAuthorize: config.onAuthorize,
    onAuthorizeFailure: config.onAuthorizeFailure,
    onPayment: config.onPayment,
    onPaymentFailure: config.onPaymentFailure
  });
  const transport = new StreamableHTTPClientTransport(new URL(args.mcpServer), {fetch: fetcher.fetch});
  return transport;
}

export async function atxpClient(args: ClientArgs): Promise<Client> {
  const config = buildClientConfig(args);
  const transport = buildStreamableTransport(config);

  const client = new Client(config.clientInfo, config.clientOptions);
  await client.connect(transport);

  return client;
}
