import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-base', {
  platform: 'neutral', // Browser/React Native
  external: [
    // Keep large blockchain libraries external
    '@base-org/account', 'viem'
  ]
});