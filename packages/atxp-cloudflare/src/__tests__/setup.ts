/* eslint-disable @typescript-eslint/no-explicit-any */
// Test setup for Cloudflare Workers environment
import { vi } from 'vitest';

// Mock ExecutionContext for Cloudflare Workers
(global as any).ExecutionContext = function ExecutionContext() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };
};

// Mock global fetch if not available
if (!global.fetch) {
  global.fetch = vi.fn();
}

// Mock global Request and Response if not available
if (!global.Request) {
  global.Request = class MockRequest {
    url: string;
    method: string;
    headers: any;
    body: any;

    constructor(url: string, init?: any) {
      this.url = url;
      this.method = init?.method || 'GET';
      this.headers = new Map(Object.entries(init?.headers || {}));
      this.body = init?.body;
    }

    clone() {
      return new MockRequest(this.url, {
        method: this.method,
        headers: Object.fromEntries(this.headers),
        body: this.body
      });
    }

    async json() {
      return this.body ? JSON.parse(this.body) : {};
    }

    async text() {
      return this.body || '';
    }
  } as any;
}

if (!global.Response) {
  global.Response = class MockResponse {
    status: number;
    headers: any;
    body: any;

    constructor(body?: any, init?: any) {
      this.status = init?.status || 200;
      this.headers = new Map(Object.entries(init?.headers || {}));
      this.body = body;
    }

    async json() {
      return this.body ? JSON.parse(this.body) : {};
    }

    async text() {
      return this.body || '';
    }
  } as any;
}