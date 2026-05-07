// Pure HTTP handler for the parse-receipt Edge Function. Runtime-portable:
// no Deno-specific imports here (those live in index.ts and config.ts).
//
// Auth model:
//   - `verify_jwt = true` is the default for Supabase Edge Functions, so the
//     platform rejects un-authed callers BEFORE we run.
//   - We then verify the email is allowlisted via Postgres (`is_allowed_user`
//     RPC). The `isAllowed` callback is injected so tests don't need a DB.
//
// AI fallback (mirrors legacy ADR-0011):
//   primary.parse → on any error, log + retry on fallback → on second error,
//   surface combined message as 502.

import type { IAiProvider } from './providers/ai-provider.ts';
import type { AiContext, ParsedReceipt } from './types.ts';

export type ParseRequestBody = {
  imageBase64: string;
  mimeType?: string;
  categories?: string[];
  products?: { name: string }[];
};

export type HandlerDeps = {
  primary: IAiProvider;
  fallback: IAiProvider;
  /** Returns true if the JWT (extracted from Authorization header) belongs to an allowlisted user. */
  isAllowed: (authHeader: string) => Promise<boolean>;
  /** Optional logger; defaults to console. Pure-function port over the Deno global. */
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? defaultLog;

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
      return jsonError(405, 'Method not allowed');
    }

    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) {
      return jsonError(401, 'Missing or malformed Authorization header');
    }

    let allowed: boolean;
    try {
      allowed = await deps.isAllowed(auth);
    } catch (err) {
      log('error', `Allowlist check failed: ${(err as Error).message}`);
      return jsonError(401, 'Allowlist check failed');
    }
    if (!allowed) {
      return jsonError(403, 'Forbidden: email not in allowlist');
    }

    let body: ParseRequestBody;
    try {
      body = (await req.json()) as ParseRequestBody;
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }
    if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
      return jsonError(400, 'imageBase64 is required (base64-encoded image, no data: prefix)');
    }

    const ctx: AiContext = {
      categories: Array.isArray(body.categories) ? body.categories : [],
      products: Array.isArray(body.products) ? body.products : [],
      mimeType: body.mimeType ?? 'image/jpeg',
    };

    let result: ParsedReceipt;
    try {
      result = await deps.primary.parse(body.imageBase64, ctx);
      log('info', `${deps.primary.name}: parsed ${result.items?.length ?? 0} items`);
    } catch (primaryErr) {
      log(
        'warn',
        `${deps.primary.name} failed, falling back to ${deps.fallback.name}: ${
          (primaryErr as Error).message
        }`,
      );
      try {
        result = await deps.fallback.parse(body.imageBase64, ctx);
        log('info', `${deps.fallback.name} (fallback) succeeded`);
      } catch (fallbackErr) {
        const combined = `AI parsing failed (both providers). ${deps.primary.name}: ${
          (primaryErr as Error).message
        } | ${deps.fallback.name}: ${(fallbackErr as Error).message}`;
        log('error', combined);
        return jsonError(502, combined);
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  };
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function defaultLog(level: 'info' | 'warn' | 'error', msg: string): void {
  const stamped = `[parse-receipt] ${msg}`;
  if (level === 'error') console.error(stamped);
  else if (level === 'warn') console.warn(stamped);
  else console.log(stamped);
}
