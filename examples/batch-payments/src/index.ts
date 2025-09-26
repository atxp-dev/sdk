#!/usr/bin/env node
import 'dotenv/config';
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';
import { atxpExpress, requirePayment, getUserId } from '@atxp/express';
import { ATXPPaymentDestination } from '@atxp/server';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3011;

async function main() {
  const server = new McpServer({
    name: 'batch-payments-example',
    version: '1.0.0',
  }, {
    capabilities: {
      logging: {},
      tools: {}
    }
  });

  server.tool(
    'batch_payment',
    'A personalized greeting that requires batch payment',
    {
      message: z.string().optional().describe('Optional custom message'),
    },
    async ({ message }: { message?: string }): Promise<CallToolResult> => {
      const userId = getUserId();

      console.log('💰 Requiring payment of $0.01...');
      await requirePayment({ price: BigNumber(0.01) });

      console.log(`✅ Payment confirmed for user ${userId}`);

      const greeting = `Hello ${userId}! Your batch payment was processed successfully.${message ? ` ${message}` : ''}`;

      return {
        content: [
          {
            type: 'text',
            text: greeting,
          }
        ],
      };
    }
  );

  const app = express();
  app.use(express.json());

  const paymentDestination = new ATXPPaymentDestination(process.env.ATXP_CONNECTION_STRING!);

  const atxpRouter = atxpExpress({
    paymentDestination,
    payeeName: 'Batch Payments Example',
    allowHttp: process.env.NODE_ENV === 'development',
    minimumPayment: BigNumber(0.05)
  });

  app.use(atxpRouter as any);

  app.post('/', async (req: Request, res: Response) => {
    console.log('📨 Received MCP request');

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        console.log('🔌 Request connection closed');
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('❌ Error handling MCP request:', error);
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

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'batch-payments-example',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // Handle unsupported methods
  ['get', 'put', 'delete', 'patch'].forEach(method => {
    (app as any)[method]('/', (req: Request, res: Response) => {
      console.log(`❌ Received unsupported ${method.toUpperCase()} request`);
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed. Use POST for MCP requests."
        },
        id: null
      });
    });
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`🎉 Batch Payments Example listening on port ${PORT}`);
    console.log(`📍 Server URL: http://localhost:${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log('');
    console.log('Configuration:');
    console.log('  💵 Middleware expects: $0.05 total payment');
    console.log('  🔧 Tool requires: $0.01 per batch');
    console.log('');
    console.log('Available tools:');
    console.log('  📋 batch_payment - Process batch payments with user tracking');
    console.log('');
    console.log('Ready to receive MCP requests with ATXP authentication and payments! 💫');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    httpServer.close(() => {
      console.log('✅ Server stopped gracefully');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down server...');
    httpServer.close(() => {
      console.log('✅ Server stopped gracefully');
      process.exit(0);
    });
  });
}

// Handle unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
