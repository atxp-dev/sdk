import { ClientConfig, FetchWrapper } from "./types.js";
import { MemoryOAuthDb, ConsoleLogger, DEFAULT_AUTHORIZATION_SERVER, FetchLike } from "@atxp/common";
import { wrapWithATXP } from "./atxpFetcher.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type RequiredClientConfigFields = 'mcpServer' | 'account';
type RequiredClientConfig = Pick<ClientConfig, RequiredClientConfigFields>;
type OptionalClientConfig = Omit<ClientConfig, RequiredClientConfigFields>;
export type ClientArgs = RequiredClientConfig & Partial<OptionalClientConfig>;
type BuildableClientConfigFields = 'oAuthDb' | 'logger';

// Detect if we're in a browser environment and bind fetch appropriately
const getFetch = (): typeof fetch => {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    // In browser, bind fetch to window to avoid "Illegal invocation" errors
    return fetch.bind(window);
  }
  // In Node.js or other environments, use fetch as-is
  return fetch;
};

export const DEFAULT_CLIENT_CONFIG: Required<Omit<OptionalClientConfig, BuildableClientConfigFields>> = {
  allowedAuthorizationServers: [DEFAULT_AUTHORIZATION_SERVER],
  approvePayment: async (_p) => true,
  fetchFn: getFetch(),
  oAuthChannelFetch: getFetch(),
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

  // Apply the ATXP wrapper to the fetch function
  const wrappedFetch = wrapWithATXP(config);

  const transport = new StreamableHTTPClientTransport(new URL(args.mcpServer), {fetch: wrappedFetch});
  return transport;
}

export async function atxpClient(args: ClientArgs): Promise<Client> {
  const config = buildClientConfig(args);
  const transport = buildStreamableTransport(config);

  const client = new Client(config.clientInfo, config.clientOptions);
  await client.connect(transport);

  return client;
}
