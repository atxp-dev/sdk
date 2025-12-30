import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    conditions: ['node', 'import'],
  },
  ssr: {
    noExternal: ['@solana/web3.js', '@solana/pay', '@solana/spl-token'],
  },
});
