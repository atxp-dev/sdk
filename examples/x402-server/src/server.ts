import express from 'express';
import cors from 'cors';
import { paymentMiddleware, createFacilitatorConfig } from '@coinbase/x402';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configure facilitator (CDP keys for mainnet, or default for demo)
const facilitator = process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
  ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)
  : undefined;

// Single line to enable X402 payments on endpoints
app.use(paymentMiddleware(
  process.env.RECIPIENT_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
  {
    '/api/resource': {
      price: '$0.01',
      network: process.env.NETWORK || 'base'
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
  console.log(`X402 Server running on http://localhost:${PORT}`);
  console.log(`Protected endpoint: GET /api/resource ($0.01 USDC)`);
});