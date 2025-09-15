import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-client', {
  platform: 'neutral', // Browser/React Native
  external: [
    // Platform-specific dependencies that should remain external
    '@solana/pay', '@solana/web3.js', 'bs58', 'react-native-url-polyfill', 
    'viem'
  ]
});