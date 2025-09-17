import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-express', {
  platform: 'node', // Node.js only (Express)
  external: [
    // Keep these external as they're peer dependencies
    'express', '@types/express'
  ]
});
