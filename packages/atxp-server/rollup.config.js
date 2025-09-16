import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-server', {
  platform: 'node', // Node.js only
  external: [
    // Keep these external as they're peer dependencies
    'express', '@types/express', 'content-type', 'raw-body'
  ]
});