// Deno entry point. Three lines: load deps, build handler, serve.
// Swapping runtimes (Cloudflare Worker, Vercel Edge, etc.) means rewriting
// this file and `config.ts` only — `handler.ts` and `providers/` are portable.

import { createHandler } from './handler.ts';
import { loadDeps } from './config.ts';

Deno.serve(createHandler(loadDeps()));
