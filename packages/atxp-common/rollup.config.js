import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-common', {
  platform: 'neutral', // Used in both Node.js and browser/React Native
  external: [
    // These should remain external for better tree shaking
    'bignumber.js', 'jose', 'oauth4webapi', 'tweetnacl', 'tweetnacl-util'
  ]
});