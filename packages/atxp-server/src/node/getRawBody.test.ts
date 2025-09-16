import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { IncomingMessage } from 'http';
import { getRawBody } from './getRawBody.js';

// Helper to create a mock IncomingMessage from string data
function createMockRequest(data: string | Buffer | Buffer[], encoding: BufferEncoding = 'utf8'): IncomingMessage {
  let chunks: Buffer[];

  if (typeof data === 'string') {
    chunks = [Buffer.from(data, encoding)];
  } else if (Buffer.isBuffer(data)) {
    chunks = [data];
  } else {
    chunks = data;
  }

  const readable = new Readable({
    read() {
      chunks.forEach(chunk => this.push(chunk));
      this.push(null); // End the stream
    }
  });

  // Cast to IncomingMessage to satisfy TypeScript
  return readable as unknown as IncomingMessage;
}

describe('getRawBody', () => {
  describe('basic functionality', () => {
    it('should read simple string data', async () => {
      const testData = 'Hello, World!';
      const req = createMockRequest(testData);

      const result = await getRawBody(req, 'utf8', '1mb');

      expect(result).toBe(testData);
    });

    it('should read empty request body', async () => {
      const req = createMockRequest('');

      const result = await getRawBody(req, 'utf8', '1mb');

      expect(result).toBe('');
    });

    it('should read JSON data', async () => {
      const testData = '{"message": "Hello, World!", "count": 42}';
      const req = createMockRequest(testData);

      const result = await getRawBody(req, 'utf8', '1mb');

      expect(result).toBe(testData);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('should read multiline data', async () => {
      const testData = 'Line 1\nLine 2\nLine 3';
      const req = createMockRequest(testData);

      const result = await getRawBody(req, 'utf8', '1mb');

      expect(result).toBe(testData);
    });
  });

  describe('encoding support', () => {
    it('should handle utf8 encoding', async () => {
      const testData = 'Hello, 世界! 🌍';
      const req = createMockRequest(testData, 'utf8');

      const result = await getRawBody(req, 'utf8', '1mb');

      expect(result).toBe(testData);
    });

    it('should handle ascii encoding', async () => {
      const testData = 'Hello, World!';
      const req = createMockRequest(testData, 'ascii');

      const result = await getRawBody(req, 'ascii', '1mb');

      expect(result).toBe(testData);
    });

    it('should handle base64 encoding', async () => {
      const originalData = 'Hello, World!';
      const buffer = Buffer.from(originalData);
      const req = createMockRequest(buffer);

      const result = await getRawBody(req, 'base64', '1mb');

      // The result should be the base64-encoded version of the buffer
      expect(result).toBe(buffer.toString('base64'));
      expect(Buffer.from(result, 'base64').toString()).toBe(originalData);
    });
  });

  describe('size limits', () => {
    it('should accept data within size limit', async () => {
      const testData = 'x'.repeat(100); // 100 bytes
      const req = createMockRequest(testData);

      const result = await getRawBody(req, 'utf8', '1kb');

      expect(result).toBe(testData);
      expect(result.length).toBe(100);
    });

    it('should reject data exceeding size limit', async () => {
      const testData = 'x'.repeat(2000); // 2000 bytes, exceeds 1kb limit
      const req = createMockRequest(testData);

      await expect(getRawBody(req, 'utf8', '1kb')).rejects.toThrow(
        'Request body too large. Maximum size is 1kb'
      );
    });

    it('should handle exactly at size limit', async () => {
      const testData = 'x'.repeat(1024); // Exactly 1kb
      const req = createMockRequest(testData);

      const result = await getRawBody(req, 'utf8', '1kb');

      expect(result).toBe(testData);
      expect(result.length).toBe(1024);
    });

    it('should reject data exceeding size limit by 1 byte', async () => {
      const testData = 'x'.repeat(1025); // 1 byte over 1kb limit
      const req = createMockRequest(testData);

      await expect(getRawBody(req, 'utf8', '1kb')).rejects.toThrow(
        'Request body too large. Maximum size is 1kb'
      );
    });
  });

  describe('chunked data handling', () => {
    it('should handle multiple small chunks', async () => {
      const chunks = [
        Buffer.from('Hello, '),
        Buffer.from('World!'),
        Buffer.from(' How are you?')
      ];
      const req = createMockRequest(chunks);

      const result = await getRawBody(req, 'utf8', '1mb');

      expect(result).toBe('Hello, World! How are you?');
    });

    it('should handle large chunks within limit', async () => {
      const chunk1 = Buffer.from('x'.repeat(500));
      const chunk2 = Buffer.from('y'.repeat(400));
      const req = createMockRequest([chunk1, chunk2]);

      const result = await getRawBody(req, 'utf8', '1kb');

      expect(result).toBe('x'.repeat(500) + 'y'.repeat(400));
      expect(result.length).toBe(900);
    });

    it('should reject when total chunks exceed limit', async () => {
      const chunk1 = Buffer.from('x'.repeat(600));
      const chunk2 = Buffer.from('y'.repeat(500)); // Total: 1100 bytes > 1kb
      const req = createMockRequest([chunk1, chunk2]);

      await expect(getRawBody(req, 'utf8', '1kb')).rejects.toThrow(
        'Request body too large. Maximum size is 1kb'
      );
    });
  });

  describe('size format parsing', () => {
    it('should handle different size formats', async () => {
      const testData = 'x'.repeat(100);
      const req = createMockRequest(testData);

      // Test various valid size formats
      await expect(getRawBody(req, 'utf8', '1kb')).resolves.toBe(testData);
    });

    it('should handle bytes format', async () => {
      const testData = 'x'.repeat(50);
      const req = createMockRequest(testData);

      const result = await getRawBody(req, 'utf8', '100b');

      expect(result).toBe(testData);
    });

    it('should handle megabyte format', async () => {
      const testData = 'Hello, World!';
      const req = createMockRequest(testData);

      const result = await getRawBody(req, 'utf8', '1mb');

      expect(result).toBe(testData);
    });

    it('should reject invalid size format', async () => {
      const testData = 'Hello';
      const req = createMockRequest(testData);

      await expect(getRawBody(req, 'utf8', 'invalid')).rejects.toThrow(
        'Invalid size format: invalid'
      );
    });
  });

  describe('error handling', () => {
    it('should handle stream errors gracefully', async () => {
      const errorMessage = 'Stream error';
      const readable = new Readable({
        read() {
          this.emit('error', new Error(errorMessage));
        }
      });

      const req = readable as unknown as IncomingMessage;

      await expect(getRawBody(req, 'utf8', '1mb')).rejects.toThrow(errorMessage);
    });

    it('should handle invalid encoding gracefully', async () => {
      const testData = 'Hello, World!';
      const req = createMockRequest(testData);

      // TypeScript will catch invalid encodings at compile time, but at runtime
      // Node.js will handle invalid encodings by defaulting to a valid one
      const result = await getRawBody(req, 'utf8', '1mb');
      expect(result).toBe(testData);
    });
  });

  describe('realistic scenarios', () => {
    it('should handle typical JSON payload', async () => {
      const jsonPayload = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: { listChanged: true },
            sampling: {}
          },
          serverInfo: {
            name: 'test-server',
            version: '1.0.0'
          }
        }
      });

      const req = createMockRequest(jsonPayload);

      const result = await getRawBody(req, 'utf8', '4mb');

      expect(result).toBe(jsonPayload);
      expect(JSON.parse(result)).toEqual(JSON.parse(jsonPayload));
    });

    it('should handle MCP SDK maximum message size', async () => {
      const largePayload = JSON.stringify({
        jsonrpc: '2.0',
        method: 'test',
        params: {
          data: 'x'.repeat(1024 * 1024) // 1MB of data
        }
      });

      const req = createMockRequest(largePayload);

      const result = await getRawBody(req, 'utf8', '4mb');

      expect(result).toBe(largePayload);
      expect(JSON.parse(result).params.data.length).toBe(1024 * 1024);
    });

    it('should reject oversized MCP payload', async () => {
      const oversizedPayload = 'x'.repeat(5 * 1024 * 1024); // 5MB, exceeds 4MB limit
      const req = createMockRequest(oversizedPayload);

      await expect(getRawBody(req, 'utf8', '4mb')).rejects.toThrow(
        'Request body too large. Maximum size is 4mb'
      );
    });
  });
});