import { wrapWithX402, BaseAccount, type ProspectivePayment } from '@atxp/client';
import { ConsoleLogger } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import dotenv from 'dotenv';

dotenv.config();

async function testX402Client() {
  const logger = new ConsoleLogger();

  // Check for required environment variables
  if (!process.env.BASE_RPC_URL || !process.env.BASE_PRIVATE_KEY) {
    console.error('Missing required environment variables: BASE_RPC_URL and BASE_PRIVATE_KEY');
    console.error('Please create a .env file with:');
    console.error('BASE_RPC_URL=your_base_rpc_url');
    console.error('BASE_PRIVATE_KEY=your_private_key');
    process.exit(1);
  }

  console.log('=== X402 Client Test ===\n');

  // Create a Base account
  const account = new BaseAccount(
    process.env.BASE_RPC_URL,
    process.env.BASE_PRIVATE_KEY
  );

  console.log('Account address:', await account.getAddress());

  // Create X402-wrapped fetch
  const x402Fetch = wrapWithX402(fetch as any, {
    account,
    approvePayment: async (payment: ProspectivePayment) => {
      console.log('\n--- Payment Approval Request ---');
      console.log(`Resource: ${payment.resourceUrl}`);
      console.log(`Amount: ${payment.amount} ${payment.currency}`);
      console.log(`Network: ${payment.network}`);

      // Auto-approve for testing (in production, prompt user)
      const approved = true;
      console.log(`Approved: ${approved}`);
      console.log('-------------------------------\n');

      return approved;
    },
    onPayment: async ({ payment }) => {
      console.log(`✅ Payment successful for ${payment.amount} ${payment.currency}`);
    },
    onPaymentFailure: async ({ payment, error }) => {
      console.error(`❌ Payment failed for ${payment.amount} ${payment.currency}:`, error.message);
    },
    logger,
    maxRetries: 1
  });

  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';

  try {
    // First, check server health
    console.log(`\nChecking server health at ${serverUrl}...`);
    const healthResponse = await fetch(`${serverUrl}/health`);
    const health = await healthResponse.json();
    console.log('Server health:', health);

    // Try to access a protected resource without payment (should fail with regular fetch)
    console.log('\n1. Attempting to access protected resource with regular fetch...');
    const regularResponse = await fetch(`${serverUrl}/protected-resource/123`);
    console.log(`Response status: ${regularResponse.status} ${regularResponse.statusText}`);

    if (regularResponse.status === 402) {
      const errorData = await regularResponse.json();
      console.log('Received 402 Payment Required:', errorData.message);
    }

    // Now try with X402-enabled fetch
    console.log('\n2. Attempting to access protected resource with X402-enabled fetch...');
    const x402Response = await x402Fetch(`${serverUrl}/protected-resource/123`);
    console.log(`Response status: ${x402Response.status} ${x402Response.statusText}`);

    if (x402Response.ok) {
      const data = await x402Response.json();
      console.log('\n🎉 Successfully accessed protected resource!');
      console.log('Transaction hash:', data.transactionHash);
      console.log('Resource data:', data.resource);
    } else {
      const errorData = await x402Response.json();
      console.log('Failed to access resource:', errorData);
    }

    // Try to access another resource
    console.log('\n3. Accessing a second protected resource...');
    const secondResponse = await x402Fetch(`${serverUrl}/protected-resource/456`);

    if (secondResponse.ok) {
      const data = await secondResponse.json();
      console.log('\n🎉 Successfully accessed second resource!');
      console.log('Resource data:', data.resource);
    }

    // Check what resources we've accessed
    const userAddress = await account.getAddress();
    console.log(`\n4. Checking accessed resources for ${userAddress}...`);
    const resourcesResponse = await fetch(`${serverUrl}/user/${userAddress}/resources`);
    const resourcesData = await resourcesResponse.json();
    console.log('Accessed resources:', resourcesData.resources);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testX402Client().catch(console.error);