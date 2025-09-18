import { wrapWithX402UsingLibrary } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Hex } from 'viem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testNewWrapper() {
  console.log('=== Testing New Wrapper Using x402 Library Functions ===');

  if (!process.env.BASE_PRIVATE_KEY) {
    console.error('Missing BASE_PRIVATE_KEY');
    process.exit(1);
  }

  const privateKey = process.env.BASE_PRIVATE_KEY as Hex;
  const logger = new ConsoleLogger({ prefix: '[NewWrapper]', level: LogLevel.DEBUG });

  // Use our new wrapper that uses x402's createPaymentHeader directly
  const x402Fetch = wrapWithX402UsingLibrary(fetch as any, privateKey, logger);

  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  const url = `${serverUrl}/api/resource`;

  console.log('Making request to:', url);
  console.log('This wrapper uses x402\'s createPaymentHeader directly (same as x402-fetch)\n');

  try {
    const response = await x402Fetch(url);

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Success! Response:', data);

      // Try to decode payment response if available
      const paymentResponseHeader = response.headers.get('x-payment-response');
      if (paymentResponseHeader) {
        const paymentResponseJson = Buffer.from(paymentResponseHeader, 'base64').toString('utf-8');
        const paymentResponse = JSON.parse(paymentResponseJson);
        console.log('Payment response:', paymentResponse);
      }

      console.log('\n🎉 The new wrapper works! This proves we can use x402\'s functions directly.');
    } else {
      console.log('❌ Request failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error: any) {
    console.log('❌ Error:', error.message || error);
  }
}

testNewWrapper().catch(console.error);