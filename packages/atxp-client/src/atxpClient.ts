import { ClientConfig, ClientArgs } from "./types.js";
import { MemoryOAuthDb, ConsoleLogger, DEFAULT_AUTHORIZATION_SERVER } from "@atxp/common";
import { atxpFetch } from "./atxpFetcher.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type RequiredClientConfigFields = 'mcpServer' | 'account';
type OptionalClientConfig = Omit<ClientConfig, RequiredClientConfigFields>;
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
  const wrappedFetch = atxpFetch(config);

  // Configure timeout and reconnection options
  const transport = new StreamableHTTPClientTransport(new URL(args.mcpServer), {
    fetch: wrappedFetch,
    reconnectionOptions: {
      maxReconnectionDelay: 60000,        // 1 minute max delay
      initialReconnectionDelay: 2000,      // Start with 2 second delay
      reconnectionDelayGrowFactor: 2.0,    // Double delay each retry
      maxRetries: 5                        // More retry attempts
    }
  });
  return transport;
}

export async function atxpClient(args: ClientArgs): Promise<Client> {
  const config = buildClientConfig(args);
  const transport = buildStreamableTransport(config);

  const client = new Client(config.clientInfo, config.clientOptions);

  // Add timeout to client connection with improved error handling
  const connectWithTimeout = async (): Promise<void> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Client connection timeout after 30 seconds'));
      }, 30000); // 30 second timeout for initial connection
    });

    const connectPromise = client.connect(transport);

    try {
      await Promise.race([connectPromise, timeoutPromise]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      config.logger.warn(`MCP client connection failed: ${errorMessage}`);
      throw new Error(`Failed to connect to MCP server: ${errorMessage}`);
    }
  };

  await connectWithTimeout();

  config.logger.info('ATXP MCP client connected successfully');
  return client;
}
