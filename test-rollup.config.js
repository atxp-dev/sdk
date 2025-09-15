import typescript from '@rollup/plugin-typescript';

export default {
  input: 'packages/atxp-common/src/index.ts',
  output: {
    file: 'test-output.js',
    format: 'es'
  },
  plugins: [
    typescript()
  ]
};