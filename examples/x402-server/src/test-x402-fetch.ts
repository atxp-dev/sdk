import { wrapFetchWithPayment, createSigner, decodeXPaymentResponse, type Hex } from 'x402-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from current directory first, then from repo root
dotenv.config(); // Load local .env if it exists
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // Also load from repo root

async function testX402Fetch() {
  // Check for required environment variables
  if (!process.env.BASE_PRIVATE_KEY) {
    console.error('Missing BASE_PRIVATE_KEY');
    process.exit(1);
  }

  const privateKey = process.env.BASE_PRIVATE_KEY as Hex;
  const serverUrl = process.env.X402_SERVER_URL || 'http://localhost:3001';
  const endpointPath = '/api/resource';
  const url = `${serverUrl}${endpointPath}`;

  console.log('Using x402-fetch library');
  console.log('Server URL:', url);

  try {
    // Create a signer for Base mainnet
    const signer = await createSigner('base', privateKey);
    console.log('Created signer with private key');

    // Wrap fetch with payment functionality
    const fetchWithPayment = wrapFetchWithPayment(fetch as any, signer, {
      maxPaymentValue: 1000000000000000000n // Maximum payment allowed (1 USDC in wei with 6 decimals = 1000000)
    });

    console.log('Making request with x402-fetch...');

    // Make a request that will trigger payment
    const response = await fetchWithPayment(url, {
      method: 'GET'
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Success! Response:', data);

      // Try to decode payment response if available
      const paymentResponseHeader = response.headers.get('x-payment-response');
      if (paymentResponseHeader) {
        const paymentResponse = decodeXPaymentResponse(paymentResponseHeader);
        console.log('Payment response:', paymentResponse);
      }
    } else {
      console.error('Request failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testX402Fetch().catch(console.error);