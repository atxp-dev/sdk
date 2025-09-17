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

  it('should export context management functions', () => {
    expect(index.getATXPWorkerContext).toBeDefined();
    expect(typeof index.getATXPWorkerContext).toBe('function');

    expect(index.setATXPWorkerContext).toBeDefined();
    expect(typeof index.setATXPWorkerContext).toBe('function');
  });

  it('should have all expected exports', () => {
    const expectedExports = [
      'atxpCloudflare',
      'requirePayment',
      'buildATXPConfig',
      'getATXPWorkerContext',
      'setATXPWorkerContext'
    ];

    expectedExports.forEach(exportName => {
      expect(index).toHaveProperty(exportName);
    });
  });
});