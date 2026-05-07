// Zod-validated reader for Vite-injected env vars. Fails loudly at startup
// if a required var is missing or empty — better than a runtime null deref
// later. Only reads `import.meta.env.VITE_*` (Vite exposes only these to
// the client bundle).

import { z } from 'zod';

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a valid URL'),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(
      20,
      'VITE_SUPABASE_ANON_KEY missing or too short — copy from Supabase Dashboard → Settings → API Keys',
    ),
});

const parsed = EnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(
    `Environment configuration is invalid. Check web/.env.local against web/.env.example.\n${issues}`,
  );
}

export const env = parsed.data;
