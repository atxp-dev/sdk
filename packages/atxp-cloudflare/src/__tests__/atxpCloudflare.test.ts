import { describe, it, expect, beforeEach, vi } from 'vitest';
import { atxpCloudflare } from '../atxpCloudflare.js';
import './setup.js';

// Mock all external dependencies
vi.mock('@atxp/server', () => ({
  checkTokenWebApi: vi.fn(),
  getOAuthMetadata: vi.fn(),
  getProtectedResourceMetadata: vi.fn(),
  parseMcpRequestsWebApi: vi.fn(),
  sendOAuthChallengeWebApi: vi.fn(),
  sendOAuthMetadataWebApi: vi.fn(),
  sendProtectedResourceMetadataWebApi: vi.fn(),
}));

vi.mock('../buildATXPConfig.js', () => ({
  buildATXPConfig: vi.fn()
}));

// No longer need workerContext mock since context is passed through props

import {
  checkTokenWebApi,
  getOAuthMetadata,
  getProtectedResourceMetadata,
  parseMcpRequestsWebApi,
  sendOAuthChallengeWebApi,
  sendOAuthMetadataWebApi,
  sendProtectedResourceMetadataWebApi,
} from '@atxp/server';
import { buildATXPConfig } from '../buildATXPConfig.js';
import { ATXPCloudflareOptions } from '../types.js';

// Mock MCP Agent
const mockMcpAgent : ATXPCloudflareOptions['mcpAgent'] = {
  serve: vi.fn().mockReturnValue({
    fetch: vi.fn().mockResolvedValue(new Response('MCP response', { status: 200 }))
  }),
  serveSSE: vi.fn().mockReturnValue({
    fetch: vi.fn().mockResolvedValue(new Response('SSE response', { status: 200 }))
  })
};

describe('atxpCloudflare', () => {
  const mockConfig = {
    logger: {
      debug: vi.fn(),
      error: vi.fn()
    }
  };

  const mockOptions : ATXPCloudflareOptions = {
    mcpAgent: mockMcpAgent,
    paymentDestination: { address: '0x1234567890123456789012345678901234567890', network: 'base' },
    payeeName: 'Test Server'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (buildATXPConfig as any).mockReturnValue(mockConfig);
  });

  it('should create a handler with default mount paths', () => {
    const handler = atxpCloudflare(mockOptions);

    expect(handler).toHaveProperty('fetch');
    expect(typeof handler.fetch).toBe('function');
    expect(buildATXPConfig).toHaveBeenCalledWith(mockOptions);
  });

  it('should create a handler with custom mount paths', () => {
    const customOptions = {
      ...mockOptions,
      mountPaths: {
        mcp: '/custom-mcp',
        sse: '/custom-sse',
        root: '/custom-root'
      }
    };

    const handler = atxpCloudflare(customOptions);

    expect(handler).toHaveProperty('fetch');
    expect(buildATXPConfig).toHaveBeenCalledWith(customOptions);
  });

  describe('fetch handler', () => {
    it('should handle protected resource metadata', async () => {
      const mockPrmMetadata = { resourceUrl: 'https://example.com' };
      const mockPrmResponse = new Response('PRM response', { status: 200 });

      (getProtectedResourceMetadata as any).mockReturnValue(mockPrmMetadata);
      (sendProtectedResourceMetadataWebApi as any).mockReturnValue(mockPrmResponse);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/test');
      const result = await handler.fetch(request, {}, {});

      expect(getProtectedResourceMetadata).toHaveBeenCalledWith(mockConfig, new URL('https://example.com/test'), {});
      expect(sendProtectedResourceMetadataWebApi).toHaveBeenCalledWith(mockPrmMetadata);
      expect(result).toBe(mockPrmResponse);
    });

    it('should handle OAuth metadata when no PRM metadata', async () => {
      const mockOAuthMetadata = { authorization_endpoint: 'https://auth.example.com' };
      const mockOAuthResponse = new Response('OAuth response', { status: 200 });

      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(mockOAuthMetadata);
      (sendOAuthMetadataWebApi as any).mockReturnValue(mockOAuthResponse);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/test');
      const result = await handler.fetch(request, {}, {});

      expect(getOAuthMetadata).toHaveBeenCalledWith(mockConfig, new URL('https://example.com/test'));
      expect(sendOAuthMetadataWebApi).toHaveBeenCalledWith(mockOAuthMetadata);
      expect(result).toBe(mockOAuthResponse);
    });

    it('should route to MCP endpoint for root path', async () => {
      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue([]);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/');
      const result = await handler.fetch(request, {}, {});

      expect(mockMcpAgent.serve).toHaveBeenCalledWith('/');
      expect(result.status).toBe(200);
      expect(await result.text()).toBe('MCP response');
    });

    it('should route to MCP endpoint for mcp path', async () => {
      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue([]);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/mcp');
      const result = await handler.fetch(request, {}, {});

      expect(mockMcpAgent.serve).toHaveBeenCalledWith('/mcp');
      expect(result.status).toBe(200);
    });

    it('should route to SSE endpoint for sse path', async () => {
      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue([]);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/sse');
      const result = await handler.fetch(request, {}, {});

      expect(mockMcpAgent.serveSSE).toHaveBeenCalledWith('/sse');
      expect(result.status).toBe(200);
    });

    it('should route to SSE endpoint for sse/message path', async () => {
      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue([]);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/sse/message');
      const result = await handler.fetch(request, {}, {});

      expect(mockMcpAgent.serveSSE).toHaveBeenCalledWith('/sse');
      expect(result.status).toBe(200);
    });

    it('should return 404 for unknown paths', async () => {
      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue([]);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/unknown');
      const result = await handler.fetch(request, {}, {});

      expect(result.status).toBe(404);
      expect(await result.text()).toBe('Not found');
    });

    it('should handle errors gracefully', async () => {
      (getProtectedResourceMetadata as any).mockImplementation(() => {
        throw new Error('Test error');
      });

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/test');
      const result = await handler.fetch(request, {}, {});

      expect(result.status).toBe(500);
      expect(result.headers.get('Content-Type')).toBe('application/json');

      const errorResponse = await result.json();
      expect(errorResponse.error).toBe('server_error');
      expect(errorResponse.error_description).toBe('Test error');
    });

    it('should process ATXP middleware with MCP requests', async () => {
      const mockTokenCheck = {
        passes: true,
        token: 'test-token',
        data: { sub: 'test-user', active: true }
      };
      const mockMcpRequests = [{ method: 'tools/list' }];

      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue(mockMcpRequests);
      (checkTokenWebApi as any).mockResolvedValue(mockTokenCheck);
      (sendOAuthChallengeWebApi as any).mockReturnValue(null);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/mcp');
      const result = await handler.fetch(request, {}, {});

      expect(parseMcpRequestsWebApi).toHaveBeenCalled();
      expect(checkTokenWebApi).toHaveBeenCalled();
      // Context is now passed through props to MCP agent instead of global context
      expect(mockMcpAgent.serve).toHaveBeenCalledWith('/mcp');
      expect(result.status).toBe(200);
    });

    it('should send OAuth challenge when token check fails', async () => {
      const mockTokenCheck = {
        passes: false,
        token: null,
        data: null
      };
      const mockChallengeResponse = new Response('Unauthorized', { status: 401 });
      const mockMcpRequests = [{ method: 'tools/list' }];

      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue(mockMcpRequests);
      (checkTokenWebApi as any).mockResolvedValue(mockTokenCheck);
      (sendOAuthChallengeWebApi as any).mockReturnValue(mockChallengeResponse);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/mcp');
      const result = await handler.fetch(request, {}, {});

      expect(sendOAuthChallengeWebApi).toHaveBeenCalledWith(mockTokenCheck);
      expect(result).toBe(mockChallengeResponse);
    });

    it('should skip ATXP processing when no MCP requests found', async () => {
      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue([]);

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/mcp');
      const result = await handler.fetch(request, {}, {});

      expect(checkTokenWebApi).not.toHaveBeenCalled();
      // No MCP requests means no ATXP processing, context is passed through props
      expect(result.status).toBe(200);
    });

    it('should handle middleware errors gracefully', async () => {
      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockImplementation(() => {
        throw new Error('Middleware error');
      });

      const handler = atxpCloudflare(mockOptions);
      const request = new Request('https://example.com/mcp');
      const result = await handler.fetch(request, {}, {});

      expect(result.status).toBe(500);
      expect(mockConfig.logger.error).toHaveBeenCalled();

      const errorResponse = await result.json();
      expect(errorResponse.error).toBe('server_error');
      expect(errorResponse.error_description).toBe('An internal server error occurred in ATXP middleware');
    });

    it('should work with custom mount paths', async () => {
      const customOptions = {
        ...mockOptions,
        mountPaths: {
          mcp: '/api/mcp',
          sse: '/api/sse',
          root: '/api'
        }
      };

      (getProtectedResourceMetadata as any).mockReturnValue(null);
      (getOAuthMetadata as any).mockResolvedValue(null);
      (parseMcpRequestsWebApi as any).mockResolvedValue([]);

      const handler = atxpCloudflare(customOptions);

      // Test custom MCP path
      let request = new Request('https://example.com/api/mcp');
      let result = await handler.fetch(request, {}, {});
      expect(mockMcpAgent.serve).toHaveBeenCalledWith('/api/mcp');
      expect(result.status).toBe(200);

      // Test custom SSE path
      request = new Request('https://example.com/api/sse');
      result = await handler.fetch(request, {}, {});
      expect(mockMcpAgent.serveSSE).toHaveBeenCalledWith('/api/sse');
      expect(result.status).toBe(200);

      // Test custom root path
      request = new Request('https://example.com/api');
      result = await handler.fetch(request, {}, {});
      expect(mockMcpAgent.serve).toHaveBeenCalledWith('/api');
      expect(result.status).toBe(200);
    });
  });
});