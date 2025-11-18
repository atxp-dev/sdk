/* eslint-disable no-console */
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';
import { requirePayment } from '@atxp/server';
import type { AuthorizationServerUrl } from '@atxp/common';
import { atxpExpress } from '@atxp/express';
import { ATXPAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PORT = process.env.PORT || 3009;

const getServer = () => {
  // Create an MCP server with implementation details
  const server = new McpServer({
    name: 'multichain-example-server',
    version: '1.0.0',
  }, { capabilities: { logging: {} } });

  // Register a tool that requires payment
  server.tool(
    'multi-chain-tool',
    'A tool that accepts payments from multiple chains',
    {
      message: z.string().optional().describe('Message to process'),
    },
    async ({ message }: { message?: string }): Promise<CallToolResult> => {
      await requirePayment({price: BigNumber(0.01)});
      return {
        content: [
          {
            type: 'text',
            text: `Payment received! Processed message: ${message || 'No message provided'}`,
          }
        ],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

// Use ATXPAccount for multi-chain support
// This will use the accounts.atxp.ai service which supports both Base and Solana
const destinationConnectionString = process.env.ATXP_DESTINATION!;
const destination = new ATXPAccount(destinationConnectionString);

console.log('Starting multichain MCP server with destination', destinationConnectionString);
console.log(`Server will listen on port ${PORT}`);

const atxpRouter = atxpExpress({
  destination: destination,
  resource: `http://localhost:${PORT}`,
  server: (process.env.ATXP_AUTH_SERVER || 'https://auth.atxp.ai') as AuthorizationServerUrl,
  mountPath: '/',
  payeeName: 'Multichain Example Server',
  allowHttp: true,
  logger: new ConsoleLogger({level: LogLevel.DEBUG})
});

app.use(atxpRouter as any);

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
app.listen(PORT as number, (error?: Error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`Multichain Example Server listening on port ${PORT}`);
  console.log('Ready to accept payments from both Base and Solana chains!');
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});
