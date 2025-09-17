import { createConfig } from '../../rollup.config.js';

export default createConfig('@atxp/cloudflare', {
  external: [
    '@atxp/common',
    '@atxp/server',
    'agents',
    'agents/mcp'
  ]
});