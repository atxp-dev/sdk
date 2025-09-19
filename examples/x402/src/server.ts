#!/usr/bin/env node
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { paymentMiddleware } from 'x402-express';
import { facilitator } from '@coinbase/x402';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PORT = process.env.PORT || 3001;
const recipientAddress = process.env.ATXP_DESTINATION! as `0x${string}`;
const network = process.env.CDP_API_KEY_ID ? "base" : "base-sepolia";

// Create MCP server with a simple tool
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'x402-example-server',
    version: '1.0.0',
  }, {
    capabilities: { tools: {} }
  });

  // Register a tool that will require X402 payment
  server.tool(
    'get_data',
    'Get premium data (requires $0.01 USDC payment via X402)',
    {
      query: z.string().describe('Search query'),
    },
    async ({ query }: { query: string }) => {
      const results = Math.floor(Math.random() * 1000);
      return {
        content: [{
          type: 'text',
          text: `Premium data for "${query}": ${results} results found.`
        }]
      };
    }
  );

  return server;
}

// Main server setup
async function main() {
  console.log('Starting X402 Example Server...');

  if (!recipientAddress) {
    console.error('ATXP_DESTINATION environment variable is required!');
    process.exit(1);
  }

  const app = express();

  // Setup X402 payment middleware
  app.use(paymentMiddleware(
    recipientAddress,
    { "POST /": { price: "$0.01", network } },
    process.env.CDP_API_KEY_ID ? facilitator : { url: "https://x402.org/facilitator" }
  ));

  app.use(express.json());

  // MCP endpoint
  app.post('/', async (req: Request, res: Response) => {
    const server = createMcpServer();

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        transport.close();
        server.close();
      });

    } catch (error) {
      console.error('Error handling MCP request:', error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`X402 MCP Server running on http://localhost:${PORT}`);
    console.log(`Payment: $0.01 USDC per request on ${network}`);
    console.log(`Recipient: ${recipientAddress}`);
  });
}

main().catch(console.error);