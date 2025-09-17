import { wrapWithX402, BaseAccount } from '@atxp/client';
import dotenv from 'dotenv';

dotenv.config();

async function testX402Client() {
  // Check for required environment variables
  if (!process.env.BASE_RPC_URL || !process.env.BASE_PRIVATE_KEY) {
    console.error('Missing BASE_RPC_URL and BASE_PRIVATE_KEY');
    process.exit(1);
  }

  // Create account
  const account = new BaseAccount(
    process.env.BASE_RPC_URL,
    process.env.BASE_PRIVATE_KEY
  );

  // Wrap fetch with X402 support
  const x402Fetch = wrapWithX402(fetch as any, account);

  // Make a single request to the protected endpoint
  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  const response = await x402Fetch(`${serverUrl}/api/resource`);

  if (response.ok) {
    const data = await response.json();
    console.log('Success:', data);
  } else {
    console.error('Failed:', response.status, response.statusText);
  }
}

testX402Client().catch(console.error);