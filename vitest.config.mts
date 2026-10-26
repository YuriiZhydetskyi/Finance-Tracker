import { defineConfig } from 'vitest/config';

// One run for every Vitest workspace. Each project keeps its own config
// (jsdom + setup for web, Node for domain and the Edge Functions), so the
// per-workspace `npm run test --workspace <name>` scripts keep working.
export default defineConfig({
  test: {
    projects: ['web', 'packages/domain', 'supabase/functions/*'],
  },
});
