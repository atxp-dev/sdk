import express from 'express';
import cors from 'cors';
import { paymentMiddleware, createFacilitatorConfig } from '@coinbase/x402';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configure facilitator
const facilitator = process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
  ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)  // Production (mainnet)
  : { url: 'https://x402.org/facilitator' };  // Public test facilitator (Base Sepolia)

// Single line to enable X402 payments on endpoints
app.use(paymentMiddleware(
  process.env.RECIPIENT_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
  {
    '/api/resource': {
      price: '$0.01',
      network: process.env.NETWORK || 'base-sepolia'  // Default to testnet
    }
  },
  facilitator
));

// Protected endpoint - X402 middleware handles payment automatically
app.get('/api/resource', (req, res) => {
  res.json({
    success: true,
    data: 'This is protected content that costs $0.01 USDC',
    timestamp: Date.now()
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  const network = process.env.NETWORK || 'base-sepolia';
  const isTestnet = network === 'base-sepolia';

  console.log(`X402 Server running on http://localhost:${PORT}`);
  console.log(`Network: ${network} (${isTestnet ? 'TESTNET - using test USDC' : 'MAINNET - real money!'})`);
  console.log(`Facilitator: ${isTestnet ? 'https://x402.org/facilitator (public)' : 'Coinbase CDP (requires API keys)'}`);
  console.log(`Protected endpoint: GET /api/resource ($0.01 USDC)`);

  if (isTestnet) {
    console.log('\n✅ Using public test facilitator - no API keys needed!');
    console.log('Get test USDC from Circle faucet for Base Sepolia to test payments.');
  }
});