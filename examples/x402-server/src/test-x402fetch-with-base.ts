import { wrapFetchWithPayment, createSigner } from 'x402-fetch';
import { BaseAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Hex } from 'viem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testX402FetchWithBaseAccount() {
  console.log('=== Using x402-fetch with BaseAccount\'s Private Key ===');

  if (!process.env.BASE_RPC || !process.env.BASE_PRIVATE_KEY) {
    console.error('Missing BASE_RPC and/or BASE_PRIVATE_KEY');
    process.exit(1);
  }

  // Create BaseAccount to verify we have the right credentials
  const account = new BaseAccount(
    process.env.BASE_RPC,
    process.env.BASE_PRIVATE_KEY
  );

  console.log('BaseAccount created with address:', account.accountId);

  // Now use x402-fetch's createSigner with the same private key
  const signer = await createSigner('base', process.env.BASE_PRIVATE_KEY as Hex);
  console.log('x402-fetch signer created');

  // Create logger
  const logger = new ConsoleLogger({ prefix: '[X402-Fetch]', level: LogLevel.DEBUG });

  // Wrap fetch with x402-fetch's payment handling
  const fetchWithPayment = wrapFetchWithPayment(fetch as any, signer, {
    maxPaymentValue: 1000000000000000000n // Maximum payment allowed
  });

  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  const url = `${serverUrl}/api/resource`;

  console.log('Making request to:', url);
  console.log('Using x402-fetch library with BaseAccount\'s credentials...\n');

  try {
    const response = await fetchWithPayment(url, {
      method: 'GET'
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Success! Response:', data);

      // Try to decode payment response if available
      const paymentResponseHeader = response.headers.get('x-payment-response');
      if (paymentResponseHeader) {
        // Decode base64
        const paymentResponseJson = Buffer.from(paymentResponseHeader, 'base64').toString('utf-8');
        const paymentResponse = JSON.parse(paymentResponseJson);
        console.log('Payment response:', paymentResponse);
      }

      console.log('\n✨ This proves x402-fetch works correctly with our Base credentials!');
      console.log('The issue with our custom wrapper must be in how we\'re creating/signing the authorization.');
    } else {
      console.log('❌ Request failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error: any) {
    console.log('❌ Error:', error.message || error);
  }
}

testX402FetchWithBaseAccount().catch(console.error);