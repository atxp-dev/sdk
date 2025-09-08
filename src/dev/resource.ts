/* eslint-disable no-console */
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';
import { atxpServer, requirePayment } from '@atxp/server';
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
      await requirePayment({price: BigNumber(0.01)});
      return {
        content: [
          {
            type: 'text',
            text: `Secure data: ${message || 'No message provided'}`,
          }
        ],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

const destination = process.env.ATXP_DESTINATION!;
console.log('Starting MCP server with destination', destination);
app.use(atxpServer({
  destination,
  network: 'base',
  resource: `http://localhost:${PORT}`,
  //server: 'http://localhost:3010',
  server: 'https://auth.atxp.ai',
  mountPath: '/',
  payeeName: 'ATXP Client Example Resource Server',
  allowHttp: true,
  logger: new ConsoleLogger({level: LogLevel.DEBUG})
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