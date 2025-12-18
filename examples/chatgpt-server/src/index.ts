#!/usr/bin/env node
/**
 * ATXP Server Example - ChatGPT Compatible
 *
 * This example demonstrates how to create an MCP server that works with
 * ChatGPT's authentication UI. Unlike the standard ATXP middleware which
 * returns HTTP 401 responses, this server returns MCP-level auth challenges
 * that trigger ChatGPT's OAuth linking flow.
 *
 * Key differences from standard ATXP server:
 * 1. Uses `atxpExpressChatGPT()` instead of `atxpExpress()`
 * 2. Tools check `isAuthenticated()` and return `requireAuth()` challenges
 * 3. Unauthenticated requests reach tool handlers instead of being blocked
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';
import { requirePayment, atxpAccountId } from '@atxp/server';
import { ATXPAccount } from '@atxp/client';

// Import ChatGPT-compatible auth helpers
import {
  atxpExpressChatGPT,
  isAuthenticated,
  requireAuth,
} from './chatgpt-auth.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3011;

// ============================================================================
// Environment Validation
// ============================================================================

function validateEnvironment() {
  if (!process.env.ATXP_CONNECTION_STRING) {
    console.error('Missing required environment variable: ATXP_CONNECTION_STRING');
    console.error('   This should be a connection string from accounts.atxp.ai');
    console.error('\nPlease check your .env file or environment setup.');
    process.exit(1);
  }

  console.log('Environment variables validated');
}

// ============================================================================
// MCP Server Definition
// ============================================================================

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'atxp-chatgpt-example',
    version: '1.0.0',
  }, {
    capabilities: {
      logging: {},
      tools: {}
    }
  });

  // --------------------------------------------------------------------------
  // Tool: public_info (no auth required)
  // --------------------------------------------------------------------------
  server.tool(
    'public_info',
    'Returns public information without requiring authentication',
    {},
    async (): Promise<CallToolResult> => {
      console.log('[public_info] Executing (no auth required)');

      return {
        content: [{
          type: 'text',
          text: 'This is public information available to anyone. ' +
                'No authentication or payment is required to access this tool.'
        }]
      };
    }
  );

  // --------------------------------------------------------------------------
  // Tool: auth_status (checks auth, returns info)
  // --------------------------------------------------------------------------
  server.tool(
    'auth_status',
    'Check your authentication status',
    {},
    async (): Promise<CallToolResult> => {
      const authenticated = isAuthenticated();
      const accountId = authenticated ? atxpAccountId() : null;

      console.log(`[auth_status] Authenticated: ${authenticated}, Account: ${accountId || 'none'}`);

      if (!authenticated) {
        return {
          content: [{
            type: 'text',
            text: 'You are not currently authenticated. ' +
                  'Try calling the "premium_greeting" tool to trigger the sign-in flow.'
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: `You are authenticated!\nAccount ID: ${accountId}`
        }]
      };
    }
  );

  // --------------------------------------------------------------------------
  // Tool: premium_greeting (requires auth + payment)
  // --------------------------------------------------------------------------
  server.tool(
    'premium_greeting',
    'A premium greeting tool that requires authentication and payment',
    {
      name: z.string().optional().describe('Your name for a personalized greeting'),
    },
    async ({ name }: { name?: string }): Promise<CallToolResult> => {
      console.log('[premium_greeting] Checking authentication...');

      // Check authentication - returns challenge if not authenticated
      const authChallenge = requireAuth('Please sign in to use the premium greeting feature');
      if (authChallenge) {
        console.log('[premium_greeting] Not authenticated, returning auth challenge');
        return authChallenge;
      }

      console.log('[premium_greeting] Authenticated, checking payment...');

      // User is authenticated, now require payment
      await requirePayment({ price: BigNumber(0.01) });

      console.log('[premium_greeting] Payment confirmed, generating greeting');

      const greeting = name
        ? `Hello, ${name}! Welcome to the premium experience.`
        : 'Hello! Welcome to the premium experience.';

      return {
        content: [{
          type: 'text',
          text: `${greeting}\n\nThank you for your payment of 0.01 USDC. ` +
                `Your account (${atxpAccountId()}) has been charged.`
        }]
      };
    }
  );

  // --------------------------------------------------------------------------
  // Tool: protected_data (requires auth only, no payment)
  // --------------------------------------------------------------------------
  server.tool(
    'protected_data',
    'Access protected data (requires authentication but no payment)',
    {},
    async (): Promise<CallToolResult> => {
      console.log('[protected_data] Checking authentication...');

      // Check authentication
      const authChallenge = requireAuth('Please sign in to access protected data');
      if (authChallenge) {
        console.log('[protected_data] Not authenticated, returning auth challenge');
        return authChallenge;
      }

      const accountId = atxpAccountId();
      console.log(`[protected_data] Authenticated as ${accountId}, returning data`);

      return {
        content: [{
          type: 'text',
          text: `Protected Data for account ${accountId}:\n\n` +
                `- Account created: (simulated data)\n` +
                `- Access level: Premium\n` +
                `- This data is only visible to authenticated users.`
        }]
      };
    }
  );

  return server;
}

// ============================================================================
// Main Server Setup
// ============================================================================

async function main() {
  console.log('Starting ATXP ChatGPT-Compatible Server Example...');

  validateEnvironment();

  const app = express();
  app.use(express.json());

  // Setup ChatGPT-compatible ATXP middleware
  console.log('Setting up ChatGPT-compatible ATXP middleware...');

  const destination = new ATXPAccount(process.env.ATXP_CONNECTION_STRING!);

  // Use the ChatGPT-compatible middleware instead of standard atxpExpress
  const atxpRouter = atxpExpressChatGPT({
    destination,
    payeeName: 'ATXP ChatGPT Example',
    allowHttp: process.env.NODE_ENV === 'development'
  });

  app.use(atxpRouter as any);

  // MCP endpoint
  app.post('/', async (req: Request, res: Response) => {
    console.log('Received MCP request');

    const server = createMcpServer();

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        console.log('Request connection closed');
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

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'atxp-chatgpt-example',
      version: '1.0.0',
      mode: 'chatgpt-compatible',
      timestamp: new Date().toISOString()
    });
  });

  // Handle unsupported methods
  ['get', 'put', 'delete', 'patch'].forEach(method => {
    (app as any)[method]('/', (req: Request, res: Response) => {
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

  // Start server
  const server = app.listen(PORT, () => {
    console.log(`\nATXP ChatGPT-Compatible Server listening on port ${PORT}`);
    console.log(`Server URL: http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log('');
    console.log('Available tools:');
    console.log('  - public_info        : No auth required');
    console.log('  - auth_status        : Shows your auth status');
    console.log('  - protected_data     : Requires authentication');
    console.log('  - premium_greeting   : Requires auth + 0.01 USDC payment');
    console.log('');
    console.log('This server uses MCP-level auth challenges for ChatGPT compatibility.');
    console.log('Ready to receive requests!');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
      console.log('Server stopped gracefully');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down...');
    server.close(() => {
      console.log('Server stopped gracefully');
      process.exit(0);
    });
  });
}

// Handle unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run
main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
