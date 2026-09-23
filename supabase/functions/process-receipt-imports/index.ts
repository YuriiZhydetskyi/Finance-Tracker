import { loadWorkerDeps } from './config.ts';
import { createHandler } from './handler.ts';

Deno.serve(createHandler(loadWorkerDeps()));
