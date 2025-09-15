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
    analyzeBundle = process.env.ANALYZE_BUNDLE === 'true',
    analyzeOptions = {}
  } = options;

  // External function to handle regex patterns and exact matches
  const isExternal = (id) => {
    // Check exact matches first
    const exactMatches = [
      '@atxp/common', '@atxp/client', '@atxp/server', '@atxp/redis', 
      '@atxp/sqlite', '@atxp/base', '@modelcontextprotocol/sdk',
      '@modelcontextprotocol/sdk/types.js', '@modelcontextprotocol/sdk/client',
      'bignumber.js', 'oauth4webapi', 'jose', 'tweetnacl', 'tweetnacl-util',
      ...platformExternals[platform],
      ...external
    ];
    
    if (exactMatches.includes(id)) return true;
    
    // Check regex patterns for deep imports
    const patterns = [
      /^viem/, // All viem imports including deep paths
      /^@solana\/web3\.js/, /^@solana\/pay/, /^@solana\/buffer-layout/, /^@solana\/spl-token/,
      /^bs58/, /^react-native-url-polyfill/, /^expo-crypto/, /^@base-org\/account/
    ];
    
    return patterns.some(pattern => pattern.test(id));
  };

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

  const plugins = [
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
    }),
    resolve({
      preferBuiltins: platform === 'node',
      browser: platform === 'neutral',
      exportConditions: platform === 'node' ? ['node'] : ['browser', 'import', 'default']
    }),
    commonjs(),
    json()
  ];

  if (analyzeBundle) {
    const defaultAnalyzeOptions = {
      summaryOnly: process.env.ANALYZE_SUMMARY_ONLY !== 'false',
      stdout: true,
      limit: parseInt(process.env.ANALYZE_LIMIT) || 10,
      showExports: process.env.ANALYZE_SHOW_EXPORTS === 'true'
    };
    plugins.push(analyzer({ ...defaultAnalyzeOptions, ...analyzeOptions }));
  }

  return [
    // ESM build - individual file builds (preserves directory structure) 
    {
      input: 'src/index.ts',
      output: {
        dir: 'dist',
        format: 'es',
        sourcemap: true,
        preserveModules: true,
        preserveModulesRoot: 'src'
      },
      external: isExternal,
      plugins
    },
    // ESM entry point bundle
    {
      input: 'src/index.ts',
      output: {
        file: 'dist/index.js',
        format: 'es',
        sourcemap: true
      },
      external: isExternal,
      plugins
    },
    // CommonJS entry point bundle
    {
      input: 'src/index.ts',
      output: {
        file: 'dist/index.cjs',
        format: 'cjs',
        sourcemap: true,
        exports: 'named'
      },
      external: isExternal,
      plugins
    },
    // TypeScript declarations
    {
      input: 'src/index.ts',
      output: {
        file: 'dist/index.d.ts',
        format: 'es'
      },
      external: isExternal,
      plugins: [dts()]
    }
  ];
};

export { createConfig };