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

  // Create account to verify we have the right credentials
  const account = new BaseAccount(
    process.env.BASE_RPC,
    process.env.BASE_PRIVATE_KEY
  );

  // Create a logger with DEBUG level to see all messages
  const logger = new ConsoleLogger({ prefix: '[X402 Client]', level: LogLevel.DEBUG });

  // Log account info
  console.log('Using RPC:', process.env.BASE_RPC);
  console.log('Account address:', account.accountId);
  console.log('Using wrapWithX402 (our custom implementation)');

  // Wrap fetch with X402 support using our custom implementation
  const x402Fetch = wrapWithX402({
    account,
    logger,
    fetchFn: fetch as any,
    approvePayment: async (payment) => {
      console.log(`Approving payment of ${payment.amount} ${payment.currency} to ${payment.iss}`);
      return true;
    },
    onPayment: async ({ payment }) => {
      console.log(`Payment made: ${payment.amount} ${payment.currency}`);
    },
    onPaymentFailure: async ({ payment, error }) => {
      console.error(`Payment failed: ${error.message}`);
    }
  });

  // Make a single request to the protected endpoint
  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  console.log('Making request to:', `${serverUrl}/api/resource`);

  const response = await x402Fetch(`${serverUrl}/api/resource`);

  if (response.ok) {
    const data = await response.json();
    console.log('Success:', data);

    // Try to decode payment response if available
    const paymentResponseHeader = response.headers.get('x-payment-response');
    if (paymentResponseHeader) {
      const paymentResponseJson = Buffer.from(paymentResponseHeader, 'base64').toString('utf-8');
      const paymentResponse = JSON.parse(paymentResponseJson);
      console.log('Payment response:', paymentResponse);
    }
  } else {
    console.error('Failed:', response.status, response.statusText);
  }
}

testX402Client().catch(console.error);