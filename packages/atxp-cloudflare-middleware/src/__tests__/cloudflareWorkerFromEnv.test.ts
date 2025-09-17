import { describe, it, expect, vi } from 'vitest';
import { atxpCloudflareWorkerFromEnv } from '../cloudflareWorkerFromEnv.js';
import './setup.js';

// Mock the atxpCloudflareWorker function
vi.mock('../cloudflareWorker.js', () => ({
  atxpCloudflareWorker: vi.fn()
}));

// Import the mocked function
import { atxpCloudflareWorker } from '../cloudflareWorker.js';

describe('atxpCloudflareWorkerFromEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (atxpCloudflareWorker as any).mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response('OK'))
    });
  });

  it('should create a handler with environment-based configuration', () => {
    const mockMcpAgent = vi.fn() as any;

    const handler = atxpCloudflareWorkerFromEnv({
      mcpAgent: mockMcpAgent,
      serviceName: 'Test Service',
      allowHttp: true,
      fundingDestination: '0x1234567890123456789012345678901234567890',
      fundingNetwork: 'base'
    });

    expect(handler).toBeDefined();
    expect(typeof handler.fetch).toBe('function');
  });

  it('should call atxpCloudflareWorker with correct config on fetch', async () => {
    const mockMcpAgent = vi.fn() as any;

    const handler = atxpCloudflareWorkerFromEnv({
      mcpAgent: mockMcpAgent,
      serviceName: 'Test Service',
      allowHttp: true,
      fundingDestination: '0x1234567890123456789012345678901234567890',
      fundingNetwork: 'base',
      mountPaths: { mcp: '/custom-mcp' }
    });

    const mockRequest = new Request('https://example.com/');
    const mockEnv = {};
    const mockCtx = new (global as any).ExecutionContext();

    await handler.fetch(mockRequest, mockEnv, mockCtx);

    expect(atxpCloudflareWorker).toHaveBeenCalledWith({
      config: {
        fundingDestination: '0x1234567890123456789012345678901234567890',
        fundingNetwork: 'base',
        payeeName: 'Test Service',
        allowHttp: true
      },
      mcpAgent: mockMcpAgent,
      serviceName: 'Test Service',
      mountPaths: { mcp: '/custom-mcp' }
    });
  });

  it('should use default payeeName when serviceName is not provided', async () => {
    const mockMcpAgent = vi.fn() as any;

    const handler = atxpCloudflareWorkerFromEnv({
      mcpAgent: mockMcpAgent,
      allowHttp: false,
      fundingDestination: '0x1234567890123456789012345678901234567890',
      fundingNetwork: 'base'
    });

    const mockRequest = new Request('https://example.com/');
    const mockEnv = {};
    const mockCtx = new (global as any).ExecutionContext();

    await handler.fetch(mockRequest, mockEnv, mockCtx);

    expect(atxpCloudflareWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          payeeName: 'MCP Server'
        }),
        serviceName: undefined
      })
    );
  });

  it('should forward the response from the wrapped handler', async () => {
    const mockMcpAgent = vi.fn() as any;
    const expectedResponse = new Response('Test Response');

    const mockHandler = {
      fetch: vi.fn().mockResolvedValue(expectedResponse)
    };
    (atxpCloudflareWorker as any).mockReturnValue(mockHandler);

    const handler = atxpCloudflareWorkerFromEnv({
      mcpAgent: mockMcpAgent,
      fundingDestination: '0x1234567890123456789012345678901234567890',
      fundingNetwork: 'base'
    });

    const mockRequest = new Request('https://example.com/');
    const mockEnv = {};
    const mockCtx = new (global as any).ExecutionContext();

    const response = await handler.fetch(mockRequest, mockEnv, mockCtx);

    expect(response).toBe(expectedResponse);
    expect(mockHandler.fetch).toHaveBeenCalledWith(mockRequest, mockEnv, mockCtx);
  });
});