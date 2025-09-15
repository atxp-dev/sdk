import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-redis', {
  platform: 'node', // Node.js only
  external: [
    // Keep Redis client external
    'ioredis'
  ]
});