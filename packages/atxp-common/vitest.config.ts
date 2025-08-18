import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // Use Node environment for crypto APIs
    globals: true,
    // Minimal setup for Node environment
  },
});