import { createClient } from '@supabase/supabase-js';
import { GeminiProvider } from '../parse-receipt/providers/gemini-provider.ts';
import { AnthropicProvider } from '../parse-receipt/providers/anthropic-provider.ts';
import type { AiContext, BulkParsedDocument } from '../parse-receipt/types.ts';
import { repairArithmeticMismatch, type ArithmeticRepairResult } from './arithmetic-repair.ts';
import { prepareReceipt, validateBulkDocument } from './domain.ts';

const BUCKET = 'receipts';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Required env var ${name} is not set`);
  return value;
}

const supabaseUrl = requiredEnv('SUPABASE_URL');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const cronToken = requiredEnv('RECEIPT_IMPORT_CRON_TOKEN');
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const primary = new GeminiProvider({ apiKey: requiredEnv('GEMINI_API_KEY') });
const fallback = new AnthropicProvider({ apiKey: requiredEnv('ANTHROPIC_API_KEY') });

type Job = { msg_id: number; read_count: number; import_file_id: string };
type ImportFile = {
  id: string;
  storage_path: string;
  mime_type: string;
  force_receipt: boolean;
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Authorization') !== `Bearer ${cronToken}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  await db.rpc('expire_stale_receipt_import_uploads');
  const { data, error } = await db.rpc('claim_receipt_import_jobs', { p_limit: 1 });
  if (error) return json({ error: 'Queue claim failed' }, 500);
  const jobs = (data ?? []) as Job[];
  const results = await Promise.all(jobs.map(processJob));
  return json({ claimed: jobs.length, results });
});

async function processJob(job: Job): Promise<{ id: string; status: string }> {
  try {
    const { data: file, error: fileError } = await db
      .from('receipt_import_files')
      .select('id, storage_path, mime_type, force_receipt')
      .eq('id', job.import_file_id)
      .single();
    if (fileError || !file?.storage_path) throw new Error('Import file metadata unavailable');
    const importFile = file as ImportFile;

    const [{ data: blob, error: downloadError }, categoriesResult, productsResult] =
      await Promise.all([
        db.storage.from(BUCKET).download(importFile.storage_path),
        db.from('categories').select('name'),
        db.from('products').select('name').limit(50),
      ]);
    if (downloadError || !blob) throw new Error('Stored document download failed');
    if (categoriesResult.error) throw new Error('Category lookup failed');

    const categories = (categoriesResult.data ?? []).map((row) => row.name);
    const ctx: AiContext = {
      categories,
      products: productsResult.error ? [] : (productsResult.data ?? []),
      mimeType: importFile.mime_type,
    };
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const { raw, allowIndependentRepair } = await parseWithFallback(
      base64,
      ctx,
      importFile.force_receipt,
    );
    let parsed = validateBulkDocument(raw);

    if (parsed.document_kind !== 'receipt') {
      await completeException(
        job,
        parsed.document_kind,
        parsed.document_kind === 'not_receipt' ? 'not_receipt' : 'uncertain',
        parsed,
        parsed.classification_reason || 'Потрібна перевірка документа.',
      );
      return { id: importFile.id, status: 'needs_review' };
    }

    const repair = await repairArithmeticMismatch(
      parsed,
      base64,
      ctx,
      allowIndependentRepair ? fallback : null,
    );
    logArithmeticRepair(importFile.id, repair);
    parsed = repair.parsed;

    const fxRate = await getFxRate(parsed.currency, parsed.date);
    const { data: signed } = await db.storage
      .from(BUCKET)
      .createSignedUrl(importFile.storage_path, 3600);
    const prepared = prepareReceipt(
      parsed,
      fxRate,
      new Set(categories),
      ulid,
      signed?.signedUrl ?? null,
    );
    if (!prepared.ok) {
      await completeException(job, 'receipt', 'validation', parsed, prepared.reason);
      return { id: importFile.id, status: 'needs_review' };
    }

    const { data: finalResult, error: finalError } = await db.rpc('finalize_receipt_import', {
      p_file_id: importFile.id,
      p_msg_id: job.msg_id,
      p_receipt: prepared.value.receipt,
      p_items: prepared.value.items,
      p_parsed_json: parsed,
    });
    if (finalError) throw new Error('Receipt finalization failed');
    const status =
      finalResult && typeof finalResult === 'object' && 'status' in finalResult
        ? String(finalResult.status)
        : 'saved';
    return { id: importFile.id, status };
  } catch (error) {
    console.error('[process-receipt-imports] job failed', job.import_file_id, publicError(error));
    await db.rpc('record_receipt_import_failure', {
      p_file_id: job.import_file_id,
      p_msg_id: job.msg_id,
      p_read_count: job.read_count,
      p_error_message: publicError(error),
    });
    return { id: job.import_file_id, status: job.read_count >= 3 ? 'needs_review' : 'queued' };
  }
}

async function parseWithFallback(
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
): Promise<{ raw: BulkParsedDocument; allowIndependentRepair: boolean }> {
  try {
    return {
      raw: await primary.parseBulk(base64, ctx, forceReceipt),
      allowIndependentRepair: true,
    };
  } catch {
    return {
      raw: await fallback.parseBulk(base64, ctx, forceReceipt),
      allowIndependentRepair: false,
    };
  }
}

function logArithmeticRepair(fileId: string, repair: ArithmeticRepairResult): void {
  if (repair.status === 'not_needed') return;
  const details = {
    file_id: fileId,
    status: repair.status,
    computed_before: repair.before?.computedTotal ?? null,
    printed_total: repair.before?.printedTotal ?? null,
    computed_after: repair.after?.computedTotal ?? null,
  };
  if (repair.status === 'accepted') {
    console.info('[process-receipt-imports] arithmetic repair accepted', details);
  } else {
    console.warn('[process-receipt-imports] arithmetic repair not accepted', details);
  }
}

async function completeException(
  job: Job,
  documentKind: string,
  exceptionKind: string,
  parsed: BulkParsedDocument,
  message: string,
): Promise<void> {
  const { error } = await db.rpc('complete_receipt_import_exception', {
    p_file_id: job.import_file_id,
    p_msg_id: job.msg_id,
    p_document_kind: documentKind,
    p_exception_kind: exceptionKind,
    p_parsed_json: parsed,
    p_error_message: message.slice(0, 4000),
  });
  if (error) throw new Error('Exception result could not be persisted');
}

async function getFxRate(currency: string, dateIso: string | null): Promise<number> {
  if (currency === 'EUR') return 1;
  if (currency !== 'UAH' || !dateIso) throw new Error('Unsupported currency or date');
  const target = new Date(`${dateIso}T00:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(target);
    date.setUTCDate(date.getUTCDate() - offset);
    const compact = date.toISOString().slice(0, 10).replaceAll('-', '');
    const response = await fetch(
      `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=${compact}&json`,
    );
    if (!response.ok) continue;
    const rows = (await response.json()) as { rate?: number }[];
    const rate = rows[0]?.rate;
    if (typeof rate === 'number' && rate > 0) return Math.round((1 / rate) * 1e6) / 1e6;
  }
  throw new Error('NBU rate unavailable');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function ulid(): string {
  let timestamp = Date.now();
  let time = '';
  for (let index = 0; index < 10; index += 1) {
    time = ALPHABET[timestamp % 32] + time;
    timestamp = Math.floor(timestamp / 32);
  }
  let random = '';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of bytes) random += ALPHABET[byte % 32];
  return time + random;
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown processing failure';
  const safePrefixes = [
    'Import file metadata unavailable',
    'Stored document download failed',
    'Category lookup failed',
    'AI result',
    'Invalid item',
    'Item ',
    'Unsupported currency or date',
    'NBU rate unavailable',
    'Receipt finalization failed',
    'Exception result could not be persisted',
  ];
  if (safePrefixes.some((prefix) => message.startsWith(prefix))) return message.slice(0, 4000);
  return 'AI provider or document processing failed.';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
