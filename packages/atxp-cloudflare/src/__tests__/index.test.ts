import { describe, it, expect } from 'vitest';
import * as index from '../index.js';
import './setup.js';

describe('index exports', () => {
  it('should export main functions', () => {
    expect(index.atxpCloudflare).toBeDefined();
    expect(typeof index.atxpCloudflare).toBe('function');

    expect(index.requirePayment).toBeDefined();
    expect(typeof index.requirePayment).toBe('function');

    expect(index.buildATXPConfig).toBeDefined();
    expect(typeof index.buildATXPConfig).toBe('function');
  });

  it('should export type definitions', () => {
    // Type exports don't exist at runtime, but we can check the module structure
    expect(Object.keys(index)).toEqual(
      expect.arrayContaining(['atxpCloudflare', 'requirePayment', 'buildATXPConfig'])
    );
  });

  it('should have all expected exports', () => {
    const expectedExports = [
      'atxpCloudflare',
      'requirePayment',
      'buildATXPConfig'
    ];

    expectedExports.forEach(exportName => {
      expect(index).toHaveProperty(exportName);
    });
  });
});