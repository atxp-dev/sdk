import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'packages/**/*.test.ts'],
    exclude: ['**/*.expo.test.ts', '**/*.expo.test.tsx', 'node_modules/**', 'dist/**'],
  },
  define: {
    global: 'globalThis',
  },
}); 