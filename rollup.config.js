import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import analyzer from 'rollup-plugin-analyzer';
import dts from 'rollup-plugin-dts';

const createConfig = (packageName, options = {}) => {
  const {
    platform = 'node',
    external = [],
    analyzeBundle = false
  } = options;

  // Define platform-specific externals
  const platformExternals = {
    node: [
      // Node.js built-ins
      'fs', 'path', 'crypto', 'http', 'https', 'url', 'stream',
      'util', 'events', 'buffer', 'process', 'os'
    ],
    neutral: [
      // These packages should be external for client/base packages
      '@solana/web3.js', '@solana/pay', '@solana/buffer-layout',
      '@solana/spl-token', 'viem', 'bs58', 'react-native-url-polyfill',
      'expo-crypto', '@base-org/account'
    ]
  };

  // Common externals for all packages
  const commonExternals = [
    '@atxp/common', '@atxp/client', '@atxp/server', '@atxp/redis', 
    '@atxp/sqlite', '@atxp/base', '@modelcontextprotocol/sdk',
    'bignumber.js', 'oauth4webapi', 'jose', 'tweetnacl', 'tweetnacl-util'
  ];

  const allExternals = [
    ...commonExternals,
    ...platformExternals[platform],
    ...external
  ];

  const plugins = [
    resolve({
      preferBuiltins: platform === 'node',
      browser: platform === 'neutral',
      exportConditions: platform === 'node' ? ['node'] : ['browser', 'import', 'default']
    }),
    commonjs(),
    json(),
    typescript({
      tsconfig: `./tsconfig.json`,
      outputToFilesystem: true
    })
  ];

  if (analyzeBundle) {
    plugins.push(analyzer({ summaryOnly: true }));
  }

  return [
    // JavaScript builds
    {
      input: 'src/index.ts',
      output: [
        {
          file: 'dist/index.js',
          format: 'es',
          sourcemap: true,
          inlineDynamicImports: true
        },
        {
          file: 'dist/index.cjs',
          format: 'cjs',
          sourcemap: true,
          exports: 'auto',
          inlineDynamicImports: true
        }
      ],
      external: allExternals,
      plugins
    },
    // TypeScript declarations
    {
      input: 'src/index.ts',
      output: {
        file: 'dist/index.d.ts',
        format: 'es'
      },
      external: allExternals,
      plugins: [dts()]
    }
  ];
};

export { createConfig };