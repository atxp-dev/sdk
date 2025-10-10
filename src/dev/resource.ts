/* eslint-disable no-console */
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';
import { atxpExpress, atxpAccountId, requirePayment, ATXPPaymentDestination } from '@atxp/express';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import 'dotenv/config';

const PORT = 3009;

const getServer = () => {
  // Create an MCP server with implementation details
  const server = new McpServer({
    name: 'stateless-streamable-http-server',
    version: '1.0.0',
  }, { capabilities: { logging: {} } });

  // Register a tool specifically for testing resumability
  server.tool(
    'secure-data',
    'Secure data',
    {
      message: z.string().optional().describe('Message to secure'),
    },
    async ({ message }: { message?: string }): Promise<CallToolResult> => {
      const userId = atxpAccountId();
      await requirePayment({price: BigNumber(0.01)});
      return {
        content: [
          {
            type: 'text',
            text: `Secure data for user ${userId}: ${message || 'No message provided'}`,
          }
        ],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

const logger = new ConsoleLogger({level: LogLevel.DEBUG});

// Validate required environment variables
if (!process.env.ATXP_DEVELOPER_TOKEN) {
  console.error('❌ Missing required environment variable: ATXP_DEVELOPER_TOKEN');
  console.error('   Please obtain your developer token from https://accounts.atxp.ai/developer');
  console.error('   and add it to your .env file:');
  console.error('   ATXP_DEVELOPER_TOKEN=atxp_dev_...');
  process.exit(1);
}

const destinationAddress = process.env.ATXP_DESTINATION!;
//const destination = new ChainPaymentDestination(destinationAddress, 'base');
const destination = new ATXPPaymentDestination(destinationAddress, { logger });

console.log('Starting MCP server with destination', destinationAddress);
app.use(atxpExpress({
  paymentDestination: destination,
  //server: 'http://localhost:3010',
  payeeName: 'ATXP Client Example Resource Server',
  minimumPayment: BigNumber(0.05),
  allowHttp: true,
  logger,
  atxpDeveloperToken: process.env.ATXP_DEVELOPER_TOKEN,
}));


app.post('/', async (req: Request, res: Response) => {
  const server = getServer();
  try {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      console.log('Request closed');
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

app.get('/', async (req: Request, res: Response) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

app.delete('/', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});


// Start the server
app.listen(PORT, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});