import { defineConfig } from 'vitest/config';

// Runs in Node: everything except index.ts and config.ts is runtime-portable.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
