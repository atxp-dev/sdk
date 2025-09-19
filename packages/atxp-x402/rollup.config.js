import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-x402', {
  platform: 'neutral', // Browser/React Native
  external: [
    // x402 and its dependencies
    'x402'
  ]
});