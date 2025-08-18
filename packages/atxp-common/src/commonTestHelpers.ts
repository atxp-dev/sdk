/* eslint-disable @typescript-eslint/no-explicit-any */
import { UrlString } from './types.js';
import { JSONRPCResponse, Result, CallToolResult, ContentBlock, JSONRPCError } from '@modelcontextprotocol/sdk/types.js';
import { paymentRequiredError } from './paymentRequiredError.js';

export const DESTINATION = 'testDestination';
export const SOURCE = 'testSource';


export function mcpResponse({id = 1, result = mcpToolResult()}: {
  id?: number,
  result?: Result
} = {}): JSONRPCResponse {
  return { jsonrpc: "2.0" as const, id, result };
}

export function mcpToolResult({
    content = [{type: 'text', text: 'tool-result'}],
    structuredContent = undefined,
    isError = false
  }: {
    content?: ContentBlock[],
    structuredContent?: any,
    isError?: boolean,
  } = {}): CallToolResult {
    return {content, structuredContent, isError};
}

export function mcpToolErrorResponse({
  content = [{type: 'text', text: 'tool-error'}],
  structuredContent = undefined,
}: {
  content?: ContentBlock[],
  structuredContent?: any,
} = {}): JSONRPCResponse {
  const result = mcpToolResult({isError: true, content, structuredContent});
  return mcpResponse({result});
}

export function paymentRequiredMessage(paymentUrl: UrlString, id: string): string {
  const err = paymentRequiredError(paymentUrl, id);
  return err.message;
}

/**
 * Creates a 401 Unauthorized response with OAuth challenge
 */
export function authRequiredResponse(resourceMetadataUrl: string = 'https://example.com/.well-known/oauth-protected-resource/mcp') {
  return {
    status: 401,
    headers: {
      'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`
    }
  };
}

/**
 * Creates an MCP initialize response with the full JSON-RPC wrapper
 */
export function mcpInitializeResponse(id: number = 0, protocolVersion: string = '2025-06-18') {
  return mcpResponse({
    id,
    result: {
      protocolVersion,
      capabilities: {},
      serverInfo: {
        name: 'test-server',
        version: '1.0.0'
      }
    }
  });
}

/**
 * Creates an MCP tool call response with custom content
 */
export function mcpToolResponse(id: number = 1, text: string = 'tool-result') {
  return mcpResponse({
    id,
    result: mcpToolResult({ 
      content: [{type: 'text', text}] 
    })
  });
}

export function mcpResponseHandler(toolResponse: JSONRPCResponse = mcpToolResponse(1, 'hello world')) {
  return function(url: any, opts: any) {
    // fetch-mock might pass the URL and options differently
    let body;
    if (typeof url === 'string' && opts && opts.body) {
      body = opts.body;
    } else if (url && url.options && url.options.body) {
      body = url.options.body;
    } else {
      // Return a default response
      return {
        status: 200,
        body: mcpResponse()
      };
    }
    
    // Parse the request to get the ID and method
    const request = JSON.parse(body as string);
    
    // Return a response based on the request method
    if (request.method === 'initialize') {
      return {
        status: 200,
        body: mcpInitializeResponse(request.id)
      };
    } else if (request.method === 'tools/call') {
      toolResponse.id = request.id
      return {
        status: 200,
        body: toolResponse
      };
    } else if (request.method === 'notifications/initialized') {
      // No response needed for notifications
      return { status: 200, body: {} };
    } else {
      // Default response
      return {
        status: 200,
        body: mcpResponse({ id: request.id, result: {} })
      };
    }
  };
}

export function mcpErrorResponse({id = 1, code = -32000, message = 'test error', data = undefined} : {
  id?: number,
  code?: number,
  message?: string,
  data?: any
}): JSONRPCError {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: { code, message, data }
  }
}

export function mcpElicitationRequiredErrorResponse({id = 1, message = 'test error', elicitationId = '123', url = 'https://auth.atxp.ai/payment-request/123', data = {}} : {
  id?: number,
  message?: string,
  elicitationId?: string,
  url?: string
  data?: any
}): JSONRPCError {
  // Code as per https://github.com/modelcontextprotocol/modelcontextprotocol/pull/887
  const code = -32604;
  const elicitationData = {elicitations: [{mode: 'url', elicitationId, url}]}
  return mcpErrorResponse({id, code, message, data: {...data, ...elicitationData}});
}