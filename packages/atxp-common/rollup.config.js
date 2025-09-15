import { createConfig } from '../../rollup.config.js';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const baseConfig = createConfig('atxp-common', {
  platform: 'neutral', // Used in both Node.js and browser/React Native
  external: [
    // These should remain external for better tree shaking
    'bignumber.js', 'jose', 'oauth4webapi', 'tweetnacl', 'tweetnacl-util',
    // Additional externals that shouldn't be bundled in individual files
    'zod', '@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/types'
  ]
});

// Add separate build for test helpers
const testHelpersConfig = [
  {
    input: 'src/commonTestHelpers.ts',
    output: {
      file: 'dist/commonTestHelpers.js',
      format: 'es',
      sourcemap: true
    },
    external: (id) => {
      return [
        '@modelcontextprotocol/sdk/types.js',
        './types.js',
        './paymentRequiredError.js'
      ].includes(id) || id.startsWith('@');
    },
    plugins: [
      typescript({
        tsconfig: false,
        compilerOptions: {
          target: 'es2020',
          module: 'esnext',
          lib: ['es2020', 'dom'],
          moduleResolution: 'node',
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          skipLibCheck: true,
          strict: true,
          declaration: false,
          sourceMap: true
        }
      })
    ]
  },
  {
    input: 'src/commonTestHelpers.ts',
    output: {
      file: 'dist/commonTestHelpers.d.ts',
      format: 'es'
    },
    external: (id) => {
      return [
        '@modelcontextprotocol/sdk/types.js',
        './types.js',
        './paymentRequiredError.js'
      ].includes(id) || id.startsWith('@');
    },
    plugins: [dts()]
  }
];

export default [...baseConfig, ...testHelpersConfig];