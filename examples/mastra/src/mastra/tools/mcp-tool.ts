import 'dotenv/config';
import { ATXPAccount, buildStreamableTransport } from '@atxp/client'
import chalk from 'chalk';
import { MastraMCPServerDefinition, LogMessage, MCPClient } from '@mastra/mcp';

interface ServiceConfig {
  mcpServer: string;
  toolName: string;
  description: string;
}

const SERVICES: Record<string, ServiceConfig> = {
  image: {
    mcpServer: 'https://image.corp.novellum.ai',
    toolName: 'image_create_image',
    description: 'image generation',
  },
  search: {
    mcpServer: 'https://search.corp.novellum.ai',
    toolName: 'search_search',
    description: 'search',
  }
};

const createServerConfigs = async (account: ATXPAccount) => {
  const serverConfigs: Record<string, MastraMCPServerDefinition> = {};

  // Create server configurations for each service
  for (const [serviceName, serviceConfig] of Object.entries(SERVICES)) {
    console.log(chalk.blue(`\nCreating transport for ${serviceName} service...`));

    // Create custom transport using atxpClient function
    const clientArgs = {
      mcpServer: serviceConfig.mcpServer,
      account,
    };

    const transport = buildStreamableTransport(clientArgs);

    // Add server configuration
    serverConfigs[serviceName] = {
      url: new URL(serviceConfig.mcpServer),
      customTransport: transport,
      logger: (logMessage: LogMessage) => {
        console.log(chalk.gray(`[${logMessage.serverName}] ${logMessage.level}: ${logMessage.message}`));
      },
      timeout: 120000,
    };
  }

  return serverConfigs;
};


const atxpConnectionString = process.env.ATXP_CONNECTION_STRING

if (!atxpConnectionString) {
  throw new Error('SOLANA_ENDPOINT and SOLANA_PRIVATE_KEY must be set');
}

const account = new ATXPAccount(atxpConnectionString);

// Create server configurations for all services
const serverConfigs = await createServerConfigs(account);

// Create a single MCPClient with all server configurations
export const mcpClient = new MCPClient({
  servers: serverConfigs,
  timeout: 15000,
}); 