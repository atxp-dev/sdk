import { wrapFetchWithPayment } from 'x402-fetch';
import { createRemoteSigner } from '@atxp/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from current directory first, then from repo root
dotenv.config(); // Load local .env if it exists
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // Also load from repo root

async function testHybridApproach() {
  console.log('=== Testing Hybrid Approach: x402-fetch + Remote Signer ===');

  // For now, we'll use the local signing since we don't have accounts-x402 running
  // But this shows how we'd use the remote signer with x402-fetch

  const accountAddress = '0x7F9D1a879750168b8f4A59734B1262D1778fDB5A';
  const accountsApiUrl = 'https://accounts.atxp.ai'; // Would be the real accounts API

  console.log('Creating remote signer for address:', accountAddress);
  console.log('Accounts API URL:', accountsApiUrl);

  // Create a remote signer that delegates to accounts-x402
  const remoteSigner = createRemoteSigner(
    accountAddress as `0x${string}`,
    accountsApiUrl
  );

  console.log('Remote signer created');

  // Use x402-fetch's wrapFetchWithPayment with our remote signer
  const fetchWithPayment = wrapFetchWithPayment(fetch as any, remoteSigner as any, {
    maxPaymentValue: 1000000000000000000n // Maximum payment allowed
  });

  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  const url = `${serverUrl}/api/resource`;

  console.log('Making request to:', url);
  console.log('Note: This will fail since we don\'t have accounts-x402 running,');
  console.log('but it demonstrates how to combine x402-fetch with remote signing.');

  try {
    const response = await fetchWithPayment(url, {
      method: 'GET'
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Success! Response:', data);
    } else {
      console.log('❌ Request failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error: any) {
    console.log('❌ Error:', error.message || error);
    console.log('\nThis is expected since we don\'t have the accounts-x402 API running.');
    console.log('In production, the remote signer would call the accounts API to sign.');
  }
}

testHybridApproach().catch(console.error);