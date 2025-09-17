import { createConfig } from '../../rollup.config.js';

export default createConfig({
  packageName: '@atxp/cloudflare-middleware',
  input: 'src/index.ts',
  external: [
    '@atxp/common',
    '@atxp/server',
    'agents'
  ]
});