import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@atxp/common': path.resolve(__dirname, '../atxp-common/src/index.ts'),
      '@atxp/client': path.resolve(__dirname, '../atxp-client/src/index.ts'),
    },
  },
});
