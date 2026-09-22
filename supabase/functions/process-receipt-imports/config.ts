// Deno-runtime glue: env loading + Supabase/provider construction. Everything
// else in this folder is runtime-portable and receives these as WorkerDeps.
// Constants live in constants.ts so portable modules never import this file.

import { createClient } from '@supabase/supabase-js';
import { AnthropicProvider } from '../_shared/receipt-ai/providers/anthropic-provider.ts';
import { GeminiProvider } from '../_shared/receipt-ai/providers/gemini-provider.ts';
import {
  BULK_ANTHROPIC_MAX_TOKENS,
  BULK_PROVIDER_TIMEOUT_MS,
  FALLBACK_MODEL,
} from './constants.ts';
import type { WorkerDeps } from './types.ts';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Required env var ${name} is not set`);
  return value;
}

export function loadWorkerDeps(): WorkerDeps {
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const cronToken = requiredEnv('RECEIPT_IMPORT_CRON_TOKEN');
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const primary = new GeminiProvider({
    apiKey: requiredEnv('GEMINI_API_KEY'),
    timeoutMs: BULK_PROVIDER_TIMEOUT_MS,
  });
  const fallback = new AnthropicProvider({
    apiKey: requiredEnv('ANTHROPIC_API_KEY'),
    model: FALLBACK_MODEL,
    timeoutMs: BULK_PROVIDER_TIMEOUT_MS,
    bulkMaxTokens: BULK_ANTHROPIC_MAX_TOKENS,
  });
  return {
    db,
    primary,
    fallback,
    cronToken,
    fetch: (input, init) => fetch(input, init),
    log: console,
  };
}
