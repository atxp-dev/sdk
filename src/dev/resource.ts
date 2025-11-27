/* eslint-disable no-console */
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
// import { BigNumber } from 'bignumber.js';
// import { atxpExpress, atxpAccountId, requirePayment } from '@atxp/express';
// import { ConsoleLogger, LogLevel } from '@atxp/common';
// import { ATXPAccount } from '@atxp/client';
// import 'dotenv/config';

const PORT = 3009;

// MCP Apps UI resource key (from @modelcontextprotocol/ext-apps)
const RESOURCE_URI_META_KEY = 'ui/resourceUri';

// Simple test UI HTML - displays the message from tool result
const TEST_UI_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      min-height: 100px;
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 24px;
      backdrop-filter: blur(10px);
      max-width: 400px;
      text-align: center;
    }
    h2 { margin: 0 0 12px 0; font-size: 18px; }
    .message { font-size: 16px; opacity: 0.9; }
    .status { font-size: 12px; opacity: 0.7; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>🔐 Secure Data UI</h2>
    <div class="message" id="message">Waiting for data...</div>
    <div class="status" id="status">Connecting...</div>
  </div>
  <script>
    // Listen for tool result from host
    window.addEventListener('message', (event) => {
      console.log('[UI] Received message:', event.data);
      const msg = event.data;

      // Handle tool result notification
      if (msg && msg.method === 'ui/notifications/tool-result') {
        const result = msg.params;
        document.getElementById('status').textContent = 'Data received!';

        if (result.structuredContent) {
          document.getElementById('message').textContent = result.structuredContent.message || 'No message';
        } else if (result.content && result.content[0]) {
          document.getElementById('message').textContent = result.content[0].text || 'No content';
        }
      }

      // Handle tool input notification (arguments before execution)
      if (msg && msg.method === 'ui/notifications/tool-input') {
        document.getElementById('status').textContent = 'Processing...';
        if (msg.params && msg.params.arguments) {
          document.getElementById('message').textContent = 'Input: ' + (msg.params.arguments.message || 'none');
        }
      }
    });

    document.getElementById('status').textContent = 'Ready - waiting for tool result';
  </script>
</body>
</html>
`;

const getServer = () => {
  // Create an MCP server with implementation details
  const server = new McpServer({
    name: 'stateless-streamable-http-server',
    version: '1.0.0',
  }, { capabilities: { logging: {}, resources: {} } });

  // Register the UI resource for MCP Apps
  server.resource(
    'secure-data-ui',
    'ui://secure-data',
    {
      description: 'UI template for the secure-data tool',
      mimeType: 'text/html',
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: 'ui://secure-data',
          mimeType: 'text/html',
          text: TEST_UI_HTML,
        }
      ],
    })
  );

  // Register the tool with UI resource reference
  server.registerTool(
    'secure-data',
    {
      description: 'Secure data with UI display',
      inputSchema: {
        message: z.string().optional().describe('Message to secure'),
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: 'ui://secure-data',
      },
    },
    async ({ message }: { message?: string }): Promise<CallToolResult> => {
      const responseMessage = `Secure data: ${message || 'No message provided'}`;
      return {
        content: [
          {
            type: 'text',
            text: responseMessage,
          }
        ],
        structuredContent: {
          message: responseMessage,
          timestamp: new Date().toISOString(),
        },
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

// const logger = new ConsoleLogger({level: LogLevel.DEBUG});

// const destinationConnectionString = process.env.ATXP_DESTINATION!;
// const destination = new ATXPAccount(destinationConnectionString);

// console.log('Starting MCP server with destination', destinationConnectionString);
// app.use(atxpExpress({
//   destination: destination,
//   server: 'https://auth.atxp.ai',
//   payeeName: 'ATXP Client Example Resource Server',
//   minimumPayment: BigNumber(0.01),
//   allowHttp: true,
//   logger
// }));


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
