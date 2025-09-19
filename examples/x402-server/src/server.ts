import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

// Create MCP server
const mcpServer = new Server({
  name: "x402-example-server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

// Add a tool that requires payment
mcpServer.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      {
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
        }
      },
      {
        name: "calculate_cost",
        description: "Calculate the cost of an operation (costs $0.005 USDC)",
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
        }
      }
    ]
  };
});

// Handle tool calls
mcpServer.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_premium_data":
      return {
        content: [
          {
            type: "text",
            text: `Premium data for query "${args.query}": This is valuable information that costs $0.01 USDC. Results: ${Math.random() * 1000} matching records found.`
          }
        ]
      };

    case "calculate_cost":
      const cost = args.amount * args.rate;
      return {
        content: [
          {
            type: "text",
            text: `Cost calculation: ${args.amount} * ${args.rate} = ${cost} (This calculation cost $0.005 USDC)`
          }
        ]
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Configure payment middleware for MCP endpoint
app.use(paymentMiddleware(
  recipientAddress,
  {
    "POST /mcp": {
      price: "$0.01",
      network: network,
    },
  },
  facilitatorConfig
));

// Create MCP transport and handle requests
const transport = new StreamableHTTPServerTransport();

// MCP endpoint
app.post("/mcp", express.json(), async (req, res) => {
  try {
    const result = await transport.handleRequest(req.body);
    res.json(result);
  } catch (error) {
    console.error("MCP request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Connect transport to server
transport.connect(mcpServer);

// Health check endpoint (free)
app.get("/health", (req, res) => {
  res.json({ status: "ok", server: "x402-mcp-example" });
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

  console.log("\nEndpoints:");
  console.log(`  POST /mcp - MCP endpoint ($0.01 USDC per request)`);
  console.log(`  GET /health - Health check (free)`);

  console.log("\nAvailable MCP tools:");
  console.log(`  - get_premium_data: Get premium data ($0.01 per request)`);
  console.log(`  - calculate_cost: Calculate costs ($0.01 per request)`);

  if (!process.env.ATXP_DESTINATION) {
    console.error("\n❌ ERROR: ATXP_DESTINATION environment variable is required!");
    process.exit(1);
  }
});