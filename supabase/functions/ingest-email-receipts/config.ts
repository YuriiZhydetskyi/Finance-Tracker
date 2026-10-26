// Deno-runtime glue: env loading + Supabase client construction. Everything
// else in this folder is runtime-portable and receives these as IngestDeps.

import { createClient } from '@supabase/supabase-js';
import { ulid } from '../_shared/encoding.ts';
import type { IngestDeps } from './handler.ts';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Required env var ${name} is not set`);
  return value;
}

export function loadIngestDeps(): IngestDeps {
  const db = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { db, newId: ulid, log: console };
}
