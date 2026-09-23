import { defineConfig } from 'vitest/config';

// Edge Function tests run in Node (not Deno) because handler.ts is deliberately
// runtime-portable: no Deno globals, only Web Fetch (Request/Response) which
// Node 20+ provides. Deno-specific entry lives in index.ts and config.ts and
// is excluded from this test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
