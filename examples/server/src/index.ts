#!/usr/bin/env node
import 'dotenv/config';
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';
import { atxpServer, requirePayment } from '@atxp/server';
import { ConsoleLogger, LogLevel, UrlString, OAuthResourceClient, createOAuthDb } from '@atxp/common';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3010;

// Validate required environment variables
function validateEnvironment() {
  const required = ['SOLANA_DESTINATION'];
  const missing = required.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\nPlease check your .env file or environment setup.');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
}

// Create MCP server with hello_world tool
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'atxp-server-example',
    version: '1.0.0',
  }, { 
    capabilities: { 
      logging: {},
      tools: {}
    } 
  });

  // Register the hello_world tool
  server.tool(
    'hello_world',
    'A simple greeting tool that requires payment',
    {
      name: z.string().optional().describe('Optional name to include in greeting'),
      message: z.string().optional().describe('Optional custom message'),
    },
    async ({ name, message }: { name?: string; message?: string }): Promise<CallToolResult> => {
      // Require payment before processing the request
      console.log('💰 Requiring payment of 0.01 USDC...');
      await requirePayment({ price: BigNumber(0.01) });
      
      console.log('✅ Payment confirmed, processing hello_world request');
      
      // Generate greeting
      const greeting = name ? `Hello, ${name}!` : 'Hello, World!';
      const customMessage = message ? ` ${message}` : ' Welcome to the ATXP server example.';
      const fullResponse = greeting + customMessage;
      
      console.log(`📝 Responding: ${fullResponse}`);
      
      return {
        content: [
          {
            type: 'text',
            text: fullResponse,
          }
        ],
      };
    }
  );

  return server;
}

// Main server setup
async function main() {
  console.log('🚀 Starting ATXP Server Example...');
  
  // Validate environment
  validateEnvironment();
  
  // Create Express app
  const app = express();
  app.use(express.json());

  // Setup ATXP middleware for authentication and payment processing
  console.log('🔐 Setting up ATXP authentication and payment middleware...');
  
  // Create OAuth components (automatically uses in-memory implementation for ':memory:')
  
  app.use(atxpServer({
    destination: process.env.SOLANA_DESTINATION!,
    resource: `http://localhost:${PORT}` as UrlString,
    server: (process.env.ATXP_SERVER || 'https://auth.atxp.ai') as UrlString,
    mountPath: '/',
    payeeName: 'ATXP Server Example',
    allowHttp: process.env.NODE_ENV === 'development',
    logger: new ConsoleLogger({ level: LogLevel.INFO }),
  }));

  // MCP endpoint - handle MCP requests
  app.post('/', async (req: Request, res: Response) => {
    console.log('📨 Received MCP request');
    
    const server = createMcpServer();
    
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
      service: 'atxp-server-example',
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

  // Start the server
  const server = app.listen(PORT, () => {
    console.log(`🎉 ATXP Server Example listening on port ${PORT}`);
    console.log(`📍 Server URL: http://localhost:${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log('');
    console.log('Available tools:');
    console.log('  📋 hello_world - A greeting tool that requires 0.01 USDC payment');
    console.log('');
    console.log('Ready to receive MCP requests with ATXP authentication and payments! 💫');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
      console.log('✅ Server stopped gracefully');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down server...');
    server.close(() => {
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

// Run the server
main().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});