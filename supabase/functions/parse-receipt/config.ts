// Deno-runtime-specific glue: env loading + Supabase client construction +
// allowlist callback. Everything else (handler, providers) is portable.
//
// Required env (set via `supabase secrets set ...` in production, or
// `supabase/.env.local` for `supabase functions serve`):
//   GEMINI_API_KEY
//   ANTHROPIC_API_KEY
//
// Auto-injected by Supabase platform (no need to set):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY

import { createClient } from '@supabase/supabase-js';
import { GeminiProvider } from './providers/gemini-provider.ts';
import { AnthropicProvider } from './providers/anthropic-provider.ts';
import type { HandlerDeps } from './handler.ts';

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Required env var "${name}" is not set`);
  return v;
}

export function loadDeps(): HandlerDeps {
  const geminiApiKey = requireEnv('GEMINI_API_KEY');
  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY');

  const primary = new GeminiProvider({ apiKey: geminiApiKey });
  const fallback = new AnthropicProvider({ apiKey: anthropicApiKey });

  // The allowlist check uses the caller's JWT against Postgres so RLS does the
  // work for us. `is_allowed_user()` is the SQL helper defined in the initial
  // migration; it returns true iff `auth.jwt()->>'email'` is in `app_users`.
  const isAllowed = async (authHeader: string): Promise<boolean> => {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc('is_allowed_user');
    if (error) throw new Error(error.message);
    return data === true;
  };

  return { primary, fallback, isAllowed };
}
