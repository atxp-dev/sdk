import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { paymentMiddleware } from "x402-express";
import { facilitator } from "@coinbase/x402";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const app = express();
const recipientAddress = process.env.ATXP_DESTINATION! as `0x${string}`;
const network = process.env.CDP_API_KEY_ID ? "base" : "base-sepolia";

// Create MCP server
const mcpServer = new Server({
  name: "x402-example-server",
  version: "1.0.0"
}, {
  capabilities: { tools: {} }
});

// Add a tool that requires payment
mcpServer.addTool({
  name: "get_premium_data",
  description: "Get premium data (costs $0.01 USDC)",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" }
    },
    required: ["query"]
  },
  handler: async (args: { query: string }) => ({
    content: [{
      type: "text",
      text: `Premium data for "${args.query}": ${Math.floor(Math.random() * 1000)} results found.`
    }]
  })
});

// Add payment middleware
app.use(paymentMiddleware(
  recipientAddress,
  { "POST /*": { price: "$0.01", network } },
  process.env.CDP_API_KEY_ID ? facilitator : { url: "https://x402.org/facilitator" }
));

// Handle MCP requests
app.use(express.json());
app.use(async (req, res) => {
  try {
    const handler = mcpServer.createHttpRequestHandler();
    const response = await handler({
      method: req.method,
      url: `http://${req.headers.host}${req.url}`,
      headers: req.headers as Record<string, string>,
      body: req.body ? JSON.stringify(req.body) : undefined
    });

    res.status(response.statusCode || 200);
    Object.entries(response.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
    res.send(response.body);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`X402 MCP Server running on http://localhost:${PORT}`);
  console.log(`Payment: $0.01 USDC per request on ${network}`);
  console.log(`Tool: get_premium_data - Get premium data`);

  if (!process.env.ATXP_DESTINATION) {
    console.error("ERROR: ATXP_DESTINATION environment variable required!");
    process.exit(1);
  }
});