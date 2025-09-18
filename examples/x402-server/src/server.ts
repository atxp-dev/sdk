import express from "express";
import { paymentMiddleware } from "x402-express";
import { facilitator } from "@coinbase/x402";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from current directory first, then from repo root
dotenv.config(); // Load local .env if it exists
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // Also load from repo root

const app = express();

// Your wallet address to receive payments
const recipientAddress = process.env.ATXP_DESTINATION! as `0x${string}`;

// Determine network based on environment
const isMainnet = process.env.CDP_API_KEY_ID !== undefined;
const network = isMainnet ? "base" : "base-sepolia";

// Configure facilitator based on environment
const facilitatorConfig = process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
  ? facilitator  // Use CDP facilitator for mainnet
  : { url: "https://x402.org/facilitator" } ; // Use public test facilitator

// Configure payment middleware
app.use(paymentMiddleware(
  recipientAddress,
  {
    "GET /api/resource": {
      price: "$0.01",
      network: network,
    },
  },
  facilitatorConfig
));

// Protected endpoint - costs $0.01 USDC
app.get("/api/resource", (req, res) => {
  res.json({
    success: true,
    data: "This is protected content that costs $0.01 USDC",
    timestamp: Date.now()
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`X402 Server (Coinbase SDK) running on http://localhost:${PORT}`);
  console.log(`Recipient address: ${recipientAddress}`);
  console.log(`Network: ${network} (${isMainnet ? 'MAINNET - real money!' : 'testnet'})`);
  console.log(`Facilitator: ${process.env.CDP_API_KEY_ID ? 'CDP (mainnet)' : 'Public test facilitator'}`);

  if (isMainnet) {
    console.log("\n⚠️  WARNING: Running on MAINNET - real USDC payments!");
  }

  console.log("\nProtected endpoints:");
  console.log(`  GET /api/resource - $0.01 USDC`);

  if (!process.env.ATXP_DESTINATION) {
    console.error("\n❌ ERROR: ATXP_DESTINATION environment variable is required!");
    process.exit(1);
  }
});