#!/usr/bin/env node
import 'dotenv/config'
import { atxpClient, SolanaAccount } from '@atxp/client';

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
    mcpServer: 'https://image.corp.novellum.ai',
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
    mcpServer: 'https://search.corp.novellum.ai',
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
  const solanaEndpoint = process.env.SOLANA_ENDPOINT;
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!solanaEndpoint) {
    console.error('Error: SOLANA_ENDPOINT environment variable is required');
    console.error('Example: SOLANA_ENDPOINT=https://api.mainnet-beta.solana.com');
    process.exit(1);
  }

  if (!solanaPrivateKey) {
    console.error('Error: SOLANA_PRIVATE_KEY environment variable is required');
    console.error('Example: SOLANA_PRIVATE_KEY=your_base58_encoded_private_key');
    process.exit(1);
  }

  try {
    // Create MCP client using atxpClient function
    const client = await atxpClient({
      mcpServer: serviceConfig.mcpServer as any,
      account: new SolanaAccount(solanaEndpoint, solanaPrivateKey),
    });

    // Call the appropriate tool using the MCP client
    const result = await client.callTool({
      name: serviceConfig.toolName,
      arguments: serviceConfig.getArguments(prompt)
    });

    debug(`${serviceConfig.description} request successful!`);
    debug('Result:', serviceConfig.getResult(result));

  } catch (error) {
    console.error(`Error with ${serviceConfig.description}:`, error);
    process.exit(1);
  }
}

// Run the application
main().catch(console.error); 
