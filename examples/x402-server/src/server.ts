import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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

// Create MCP server with tools
const mcpServer = new Server({
  name: "x402-example-server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

// Add tools that require payment
mcpServer.addTool({
  name: "get_premium_data",
  description: "Get premium data (costs $0.01 USDC)",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The query to search for"
      }
    },
    required: ["query"]
  },
  handler: async (args: { query: string }) => {
    return {
      content: [
        {
          type: "text",
          text: `Premium data for query "${args.query}": This is valuable information that costs $0.01 USDC. Results: ${Math.floor(Math.random() * 1000)} matching records found.`
        }
      ]
    };
  }
});

mcpServer.addTool({
  name: "calculate_cost",
  description: "Calculate the cost of an operation (costs $0.01 USDC)",
  inputSchema: {
    type: "object",
    properties: {
      amount: {
        type: "number",
        description: "The amount to calculate cost for"
      },
      rate: {
        type: "number",
        description: "The rate to apply"
      }
    },
    required: ["amount", "rate"]
  },
  handler: async (args: { amount: number; rate: number }) => {
    const cost = args.amount * args.rate;
    return {
      content: [
        {
          type: "text",
          text: `Cost calculation: ${args.amount} * ${args.rate} = ${cost} (This calculation cost $0.01 USDC)`
        }
      ]
    };
  }
});

// Configure payment middleware for all MCP requests
// The middleware will intercept all requests and require payment
app.use(paymentMiddleware(
  recipientAddress,
  {
    // Require payment for all POST requests (MCP uses POST)
    "POST /*": {
      price: "$0.01",
      network: network,
    },
  },
  facilitatorConfig
));

// Parse JSON bodies
app.use(express.json());

// Handle all requests - MCP SDK will handle the routing
app.use(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Create a fetch-like request for the MCP SDK
  const mcpRequest = {
    method: req.method,
    url: url.toString(),
    headers: req.headers as Record<string, string>,
    body: req.body ? JSON.stringify(req.body) : undefined
  };

  try {
    // Let the MCP SDK handle the request
    const handler = mcpServer.createHttpRequestHandler();
    const response = await handler(mcpRequest);

    // Send the response
    res.status(response.statusCode || 200);
    for (const [key, value] of Object.entries(response.headers || {})) {
      res.setHeader(key, value);
    }
    res.send(response.body);
  } catch (error) {
    console.error("MCP request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`X402 MCP Server running on http://localhost:${PORT}`);
  console.log(`Recipient address: ${recipientAddress}`);
  console.log(`Network: ${network} (${isMainnet ? 'MAINNET - real money!' : 'testnet'})`);
  console.log(`Facilitator: ${process.env.CDP_API_KEY_ID ? 'CDP (mainnet)' : 'Public test facilitator'}`);

  if (isMainnet) {
    console.log("\n⚠️  WARNING: Running on MAINNET - real USDC payments!");
  }

  console.log("\nPayment required: $0.01 USDC per request");
  console.log("\nAvailable MCP tools:");
  console.log(`  - get_premium_data: Get premium data`);
  console.log(`  - calculate_cost: Calculate costs`);

  if (!process.env.ATXP_DESTINATION) {
    console.error("\n❌ ERROR: ATXP_DESTINATION environment variable is required!");
    process.exit(1);
  }
});