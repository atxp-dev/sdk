import { createConfig } from '../../rollup.config.js';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';

const mainConfigs = createConfig('atxp-server', {
  platform: 'node', // Node.js only
  external: [
    // Keep these external as they're peer dependencies
    'content-type'
  ]
});

// Add serverTestHelpers build
const serverTestHelpersConfigs = [
  // ESM build
  {
    input: 'src/serverTestHelpers.ts',
    output: {
      file: 'dist/serverTestHelpers.js',
      format: 'es',
      sourcemap: true
    },
    external: (id) => {
      const externals = [
        '@atxp/common', '@atxp/server', '@atxp/client', '@atxp/base', '@atxp/worldchain',
        'vitest', 'bignumber.js', 'oauth4webapi',
        'fs', 'path', 'crypto', 'http', 'https', 'url', 'stream', 'util', 'events', 'buffer', 'process', 'os',
        'node:fs', 'node:path', 'node:crypto', 'node:http', 'node:https', 'node:url', 'node:stream',
        'node:util', 'node:events', 'node:buffer', 'node:process', 'node:os'
      ];
      return externals.includes(id);
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
      }),
      resolve({ preferBuiltins: true, exportConditions: ['node'] }),
      commonjs(),
      json()
    ]
  },
  // TypeScript declarations
  {
    input: 'src/serverTestHelpers.ts',
    output: {
      file: 'dist/serverTestHelpers.d.ts',
      format: 'es'
    },
    external: (id) => {
      const externals = [
        '@atxp/common', '@atxp/server', '@atxp/client', '@atxp/base', '@atxp/worldchain',
        'vitest', 'bignumber.js', 'oauth4webapi',
        'fs', 'path', 'crypto', 'http', 'https', 'url', 'stream', 'util', 'events', 'buffer', 'process', 'os',
        'node:fs', 'node:path', 'node:crypto', 'node:http', 'node:https', 'node:url', 'node:stream',
        'node:util', 'node:events', 'node:buffer', 'node:process', 'node:os'
      ];
      return externals.includes(id);
    },
    plugins: [dts()]
  }
];

export default [...mainConfigs, ...serverTestHelpersConfigs];