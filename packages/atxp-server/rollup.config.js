import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-server', {
  platform: 'node', // Node.js only
  external: [
    // Keep these external as they're commonly available
    'express', '@types/express', 'content-type'
  ]
});