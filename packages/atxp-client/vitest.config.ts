import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/setup.expo.ts'],
  },
  resolve: {
    alias: {
      '@atxp/mpp': path.resolve(__dirname, '../atxp-mpp/src/index.ts'),
    },
  },
});
