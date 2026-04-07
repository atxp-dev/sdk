/* eslint-disable no-console */
/**
 * Test CLI using BaseAccount for X402 protocol testing (Option B).
 * Uses BASE_PRIVATE_KEY from .env to create a wallet-backed account.
 */
import { atxpClient } from '@atxp/client';
import { BaseAccount } from '@atxp/base';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import 'dotenv/config';

async function main() {
  console.log('Starting X402 test with BaseAccount...\n');

  const privateKey = process.env.BASE_PRIVATE_KEY;
  if (!privateKey) {
    console.error('BASE_PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  const url = process.argv[2] || 'http://localhost:3009';
  const toolName = process.argv[3] || 'secure-data';

  console.log(`Calling tool "${toolName}" at URL: ${url}`);
  console.log(`Using BaseAccount (X402 protocol)\n`);

  try {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/demo';
    const account = new BaseAccount(rpcUrl, privateKey);
    console.log(`Account address: ${await account.getAccountId()}`);

    const mcpClient = await atxpClient({
      mcpServer: url,
      account,
      allowedAuthorizationServers: ['http://localhost:3010', 'https://auth.atxp.ai'],
      allowHttp: true,
      logger: new ConsoleLogger({ level: LogLevel.DEBUG }),
    });

    const res = await mcpClient.callTool({
      name: toolName,
      arguments: {},
    });

    console.log('Result:', res);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Unknown error:', error);
    }
  }
}

main();
