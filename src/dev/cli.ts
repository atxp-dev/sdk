/* eslint-disable no-console */
import { atxpClient, ATXPAccount, BaseAccount, SolanaAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import 'dotenv/config';

function validateEnv() {
  const requiredVars = ['BASE_RPC', 'BASE_PRIVATE_KEY'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}\nPlease set them in your .env file or environment.`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const url = args[0] || 'http://localhost:3009';
  const toolName = args[1] || 'secure-data';
  
  // Parse named arguments
  const namedArgs: Record<string, string> = {};
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    const [key, value] = arg.split('=');
    if (key && value) {
      namedArgs[key] = value;
    }
  }

  return { url, toolName, namedArgs };
}

async function main() {
  console.log('Starting ATXP Client example...');
  console.log('\nUsage:');
  console.log('Via npm: npm run cli [url] [toolName] [arg1=value1] [arg2=value2]');
  console.log('\nExample: npm run cli http://localhost:3009 secure-data message=hello\n');
  console.log('\nExample: npm run cli https://search.mcp.atxp.ai search_search query=KingEngland\n');
  console.log('--------------------------------');
  
  const { url, toolName, namedArgs } = parseArgs();
  console.log(`Calling tool "${toolName}" at URL: ${url}`);
  if (Object.keys(namedArgs).length > 0) {
    console.log('With arguments:', namedArgs);
  }
  
  try {
    validateEnv();

    //const account = new SolanaAccount(process.env.SOLANA_ENDPOINT!, process.env.SOLANA_PRIVATE_KEY!);
    const account = new ATXPAccount(process.env.ATXP_CONNECTION_STRING!, {
      network: 'base_sepolia' // Use testnet network since the account has testnet addresses
    });
    //const account = new BaseAccount(process.env.BASE_RPC!, process.env.BASE_PRIVATE_KEY! as `0x${string}`);
    const mcpClient = await atxpClient({
      mcpServer: url,
      account,
      allowedAuthorizationServers: ['http://localhost:3010', 'https://auth.atxp.ai', 'https://atxp-accounts-staging.onrender.com/'],
      allowHttp: true,
      logger: new ConsoleLogger({level: LogLevel.DEBUG})
    });
    const res = await mcpClient.callTool({
      name: toolName,
      arguments: namedArgs
    });
    
    console.log('Result:', res);

  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Unknown error:', error);
    }
  } finally {
    process.exit(0);
  }
}

// Run the example
main().catch(console.error); 
