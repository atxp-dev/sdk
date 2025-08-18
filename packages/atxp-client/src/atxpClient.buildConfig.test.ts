import { describe, it, expect, vi } from 'vitest';
import { buildClientConfig } from './atxpClient.js';

describe('buildConfig', () => {
  it('should use fetchFn for oAuthChannelFetch if the former is provided and not the latter', () => {
    const fetchFn = vi.fn();
    const config = buildClientConfig({
      fetchFn,
      mcpServer: 'https://example.com/mcp',
      account: {
        accountId: 'bdj',
        paymentMakers: {}
      }
    });
    expect(config.oAuthChannelFetch).toBe(fetchFn);
  });
});