import { describe, it, expect } from 'vitest';
import httpMocks from 'node-mocks-http';
import { parseMcpRequests } from './node/http.js';
import * as TH from './serverTestHelpers.js'

describe('http', () => {
  describe('parseMcpMessages', () => {
    it('should extract a tool message', async () => {
      const req = TH.incomingMessage({
        body: TH.mcpToolRequest({toolName: 'testTool', args: { paramOne: 'test' }})
      });
      const url = new URL('https://example.com/');
      const msgs = await parseMcpRequests(TH.config(), url, req);
      expect(msgs).toEqual([{
        id: 'call-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'testTool',
          arguments: { paramOne: 'test' }
        },
      }]);
    });

    it('should return multiple messages for a request', async () => {
      const req = TH.incomingMessage({ body:[
        TH.mcpToolRequest({toolName: 'testTool'}),
        TH.mcpToolRequest({toolName: 'testTool2'})
      ]});
      const url = new URL('https://example.com');
      const msgs = await parseMcpRequests(TH.config(), url, req);
      expect(msgs.length).toEqual(2);
      expect((msgs[0] as any).params.name).toEqual('testTool');
      expect((msgs[1] as any).params.name).toEqual('testTool2');
    });

    it('should return an empty array for a post with a non-MCP body', async () => {
      const req = TH.incomingMessage({body: { not: 'a-mcp-message' }});
      const url = new URL('https://example.com/mcp');
      const msgs = await parseMcpRequests(TH.config(), url, req);
      expect(msgs).toEqual([]);
    });

    it('should return an empty array for GET requests', async () => { 
      const req = TH.incomingMessage({method: 'GET'});
      const url = new URL('https://example.com/mcp');
      const msgs = await parseMcpRequests(TH.config(), url, req);
      expect(msgs).toEqual([]);
    });

    it('should not return messages for an arbitrary sub-path of the mountPath', async () => {
      const pathConfig = TH.config({
        mountPath: '/mount-path'
      });
      const req = TH.incomingMessage({
        body: TH.mcpToolRequest({toolName: 'testTool'}), 
      });
      const url = new URL('https://example.com/mount-path/sub-path');
      const msgs = await parseMcpRequests(pathConfig, url, req);
      expect(msgs).toEqual([]);
    });

    it('should ignore MCP messages outside of its mountPath', async () => {
      const subPathConfig = TH.config({mountPath: '/mount-path'});
      const req = TH.incomingMessage({
        body: TH.mcpToolRequest({toolName: 'testTool'}), 
      });
      const url = new URL('https://example.com/not-the-mount-path');
      const msgs = await parseMcpRequests(subPathConfig, url, req);
      expect(msgs).toEqual([]);
    });

    it('should extract MCP messages from SSE endpoints', async () => {
      const req = TH.incomingMessage({
        body: TH.mcpToolRequest({toolName: 'testTool'}), 
      });
      const url = new URL('https://example.com/mcp/message');
      const msgs = await parseMcpRequests(TH.config({mountPath: '/mcp'}), url, req);
      expect(msgs).toEqual([{
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'testTool',
          arguments: { paramOne: 'test' }
        },
        id: 'call-1',
      }]);
    });

    it('should treat an empty path as /', async () => {
      const req = TH.incomingMessage({
        body: TH.mcpToolRequest({toolName: 'testTool'}), 
      });
      const url = new URL('https://example.com');
      const msgs = await parseMcpRequests(TH.config(), url, req);
      expect(msgs).toEqual([{
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'testTool',
          arguments: { paramOne: 'test' }
        },
        id: 'call-1',
      }]);
    });

    it('should treat an empty mountPath as /', async () => {
      const req = TH.incomingMessage({
        body: TH.mcpToolRequest({toolName: 'testTool'})
      });
      const emptyMountPathConfig = TH.config({mountPath: ''});
      const url = new URL('https://example.com');
      const msgs = await parseMcpRequests(emptyMountPathConfig, url, req);
      expect(msgs).toEqual([{
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'testTool',
          arguments: { paramOne: 'test' }
        },
        id: 'call-1',
      }]);
    });

    it('should extract from an already parsed body', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        body: TH.mcpToolRequest({toolName: 'testTool', args: { paramOne: 'test' }})
      });
      const url = new URL('https://example.com/mcp/message');
      const msgs = await parseMcpRequests(TH.config({mountPath: '/mcp/'}), url, req, req.body);
      expect(msgs).toEqual([{
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'testTool',
          arguments: { paramOne: 'test' }
        },
        id: 'call-1',
      }]);
    });
  });
});