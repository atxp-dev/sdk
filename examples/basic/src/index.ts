#!/usr/bin/env node
import 'dotenv/config'
import { atxpClient, ATXPAccount } from '@atxp/client';

// Debug function that only prints when DEBUG environment variable is set
function debug(...args: any[]) {
  if (process.env.DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

interface ServiceConfig {
  mcpServer: string;
  toolName: string;
  description: string;
  getArguments: (prompt: string) => Record<string, any>;
  getResult: (result: any) => any;
}

const SERVICES: Record<string, ServiceConfig> = {
  image: {
    mcpServer: 'https://image.mcp.atxp.ai',
    toolName: 'image_create_image',
    description: 'image generation',
    getArguments: (prompt: string) => ({ prompt }),
    getResult: (result: any) => {
            // Handle different result formats based on service
      if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
        try {
          const parsedResult = JSON.parse(result.content[0].text);
          return parsedResult.url
        } catch (e) {
          return result.content[0].text
        }
      }
    }
  },
  search: {
    mcpServer: 'https://search.mcp.atxp.ai',
    toolName: 'search_search',
    description: 'search',
    getArguments: (prompt: string) => ({ query: prompt }),
    getResult: (result: any) => result.content[0].text
  }
};

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node index.js <service> "your prompt/query here"');
    console.error('Services available:');
    console.error('  image - Generate images');
    console.error('  search - Search for information');
    console.error('');
    console.error('Examples:');
    console.error('  node index.js image "a beautiful sunset over mountains"');
    console.error('  node index.js search "latest news about AI"');
    process.exit(1);
  }

  const service = args[0].toLowerCase();
  const prompt = args[1];

  if (!SERVICES[service]) {
    console.error(`Error: Unknown service "${service}"`);
    console.error('Available services:', Object.keys(SERVICES).join(', '));
    process.exit(1);
  }

  const serviceConfig = SERVICES[service];
  debug(`Using ${serviceConfig.description} service with prompt: "${prompt}"`);

  // Validate environment variables
  const atxpConnectionString = process.env.ATXP_CONNECTION_STRING;

  if (!atxpConnectionString) {
    console.error('Error: ATXP_CONNECTION_STRING environment variable is required');
    console.error('Example: ATXP_CONNECTION_STRING=https://accounts.atxp.ai/?connection_token=your_connection_token_here');
    process.exit(1);
  }
  try {
    // Create MCP client using atxpClient function
    const client = await atxpClient({
      mcpServer: serviceConfig.mcpServer as any,
      account: new ATXPAccount(atxpConnectionString),
    });

    // Call the appropriate tool using the MCP client
    const result = await client.callTool({
      name: serviceConfig.toolName,
      arguments: serviceConfig.getArguments(prompt)
    });

    console.log(`${serviceConfig.description} request successful!`);
    console.log('Result:', serviceConfig.getResult(result));

  } catch (error) {
    console.error(`Error with ${serviceConfig.description}:`, error);
    process.exit(1);
  }
}

// Run the application
main().catch(console.error); 
