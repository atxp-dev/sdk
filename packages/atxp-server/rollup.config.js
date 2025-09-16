import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-server', {
  platform: 'node', // Node.js only
  external: [
    // Keep these external as they're commonly available or user-provided
    'express', '@types/express', 'content-type',
    // HTTP utilities that are commonly available in Node.js environments
    'raw-body', 'bytes', 'http-errors', 'depd', 'iconv-lite'
  ]
});