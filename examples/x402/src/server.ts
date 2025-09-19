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

  // Capture raw body as Buffer for all requests
  // This ensures we can replay the body for both X402 and MCP processing
  app.use(express.raw({ type: '*/*', limit: '10mb' }));

  // Setup X402 payment middleware for POST only
  const x402Middleware = paymentMiddleware(
    recipientAddress,
    {
      //"POST /": { price: "$0.01", network }
    },
    process.env.CDP_API_KEY_ID ? facilitator : { url: "https://x402.org/facilitator" }
  );

  // MCP endpoint - handle both GET and POST
  const handleMcpRequest = async (req: Request, res: Response) => {
    console.log('Received request with headers:', req.headers);
    console.log('Accept header:', req.headers.accept);

    // Don't process if payment was already handled (avoid double processing)
    if (res.headersSent) {
      return;
    }

    const server = createMcpServer();

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      await server.connect(transport);

      // If we have a body, parse it and pass it to the transport
      let parsedBody = undefined;
      if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
        try {
          parsedBody = JSON.parse(req.body.toString());
          console.log('Parsed body:', JSON.stringify(parsedBody, null, 2));
        } catch (e) {
          console.error('Failed to parse body:', e);
        }
      }

      // Pass the parsed body to the transport
      await transport.handleRequest(req, res, parsedBody);

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
  };

  // Apply X402 middleware and handle MCP requests
  // The middleware will process payments, then pass control to the MCP handler
  //app.get('/', x402Middleware, handleMcpRequest);
  //app.post('/', x402Middleware, handleMcpRequest);
  app.get('/', handleMcpRequest);
  app.post('/', handleMcpRequest);

  const server = app.listen(PORT, () => {
    console.log(`X402 MCP Server running on http://localhost:${PORT}`);
    console.log(`Payment: $0.01 USDC per request on ${network}`);
    console.log(`Recipient: ${recipientAddress}`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\nShutting down server...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });

    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 5000);
  };

  // Handle termination signals
  process.on('SIGINT', shutdown);  // Ctrl-C
  process.on('SIGTERM', shutdown); // Terminal close
  process.on('SIGHUP', shutdown);  // Terminal disconnect
}

main().catch(console.error);