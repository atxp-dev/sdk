import { wrapFetchWithPayment, createSigner, type Hex } from 'x402-fetch';
import { wrapWithX402, BaseAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function compareImplementations() {
  if (!process.env.BASE_RPC || !process.env.BASE_PRIVATE_KEY) {
    console.error('Missing BASE_RPC and/or BASE_PRIVATE_KEY');
    process.exit(1);
  }

  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  const endpointPath = '/api/resource';
  const url = `${serverUrl}${endpointPath}`;

  console.log('=== Testing Official x402-fetch Library ===');
  try {
    const privateKey = process.env.BASE_PRIVATE_KEY as Hex;
    const signer = await createSigner('base', privateKey);

    // Intercept fetch to log headers
    const originalFetch = fetch;
    const loggingFetch = async (input: any, init?: any) => {
      console.log('x402-fetch request headers:', init?.headers);
      return originalFetch(input, init);
    };

    const fetchWithPayment = wrapFetchWithPayment(loggingFetch as any, signer, {
      maxPaymentValue: 1000000000000000000n
    });

    const response = await fetchWithPayment(url, { method: 'GET' });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ x402-fetch Success:', data);
    } else {
      console.log('❌ x402-fetch Failed:', response.status);
    }
  } catch (error) {
    console.error('x402-fetch Error:', error);
  }

  console.log('\n=== Testing Custom wrapWithX402 Implementation ===');
  try {
    const account = new BaseAccount(
      process.env.BASE_RPC,
      process.env.BASE_PRIVATE_KEY
    );

    const logger = new ConsoleLogger({ prefix: '[Custom]', level: LogLevel.DEBUG });

    // Intercept fetch to log headers
    const originalFetch = fetch;
    const loggingFetch = async (input: any, init?: any) => {
      console.log('Custom wrapper request headers:', init?.headers);
      return originalFetch(input, init);
    };

    const x402Fetch = wrapWithX402(loggingFetch as any, account, logger);

    const response = await x402Fetch(url);

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Custom wrapper Success:', data);
    } else {
      console.log('❌ Custom wrapper Failed:', response.status);
    }
  } catch (error) {
    console.error('Custom wrapper Error:', error);
  }
}

compareImplementations().catch(console.error);