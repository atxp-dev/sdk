import { wrapWithX402, BaseAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from current directory first, then from repo root
dotenv.config(); // Load local .env if it exists
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // Also load from repo root

async function testX402Client() {
  // Check for required environment variables
  if (!process.env.BASE_RPC || !process.env.BASE_PRIVATE_KEY) {
    console.error('Missing BASE_RPC and/or BASE_PRIVATE_KEY');
    process.exit(1);
  }

  // Create account
  const account = new BaseAccount(
    process.env.BASE_RPC,
    process.env.BASE_PRIVATE_KEY
  );

  // Create a logger with DEBUG level to see all messages
  const logger = new ConsoleLogger({ prefix: '[X402 Client]', level: LogLevel.DEBUG });

  // Log account info
  console.log('Using RPC:', process.env.BASE_RPC);
  console.log('Account address:', account.accountId);

  // Wrap fetch with X402 support
  const x402Fetch = wrapWithX402(fetch as any, account, logger);

  // Make a single request to the protected endpoint
  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  console.log('Making request to:', `${serverUrl}/api/resource`);

  const response = await x402Fetch(`${serverUrl}/api/resource`);

  if (response.ok) {
    const data = await response.json();
    console.log('Success:', data);
  } else {
    console.error('Failed:', response.status, response.statusText);
  }
}

testX402Client().catch(console.error);