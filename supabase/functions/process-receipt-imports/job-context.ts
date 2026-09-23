import { EMPTY_PRODUCT_TAXONOMY } from '../_shared/receipt-ai/taxonomy.ts';
import type { AiContext, ProductTaxonomyContext } from '../_shared/receipt-ai/types.ts';
import { BUCKET } from './constants.ts';
import { bytesToBase64 } from './encoding.ts';
import type { ParseRun } from './parsing.ts';
import type { AttemptHandle, ImportFile } from './types.ts';

/** Per-delivery mutable state that the failure path needs to finish journals correctly. */
export type JobRun = ParseRun & {
  workerAttempt: AttemptHandle | null;
  longReceiptMode: boolean;
  manualAttempt: AttemptHandle | null;
  manualAttemptFinished: boolean;
};

export type JobContext = {
  importFile: ImportFile;
  manualSubmission: boolean;
  structuredPastedOrder: boolean;
  categories: string[];
  taxonomy: ProductTaxonomyContext;
  ctx: AiContext;
  base64: string;
};

export async function loadJobContext(run: JobRun): Promise<JobContext> {
  const { db } = run.deps;
  const { data: file, error: fileError } = await db
    .from('receipt_import_files')
    .select('id, storage_path, mime_type, force_receipt, manual_json, parsed_json')
    .eq('id', run.job.import_file_id)
    .single();
  if (fileError || !file || (!file.storage_path && file.manual_json == null)) {
    throw new Error('Import file metadata unavailable');
  }
  const importFile = file as ImportFile;
  const manualSubmission = importFile.manual_json != null;
  // Only a record created through create_manual_receipt_import_batch has no
  // Storage file. That RPC is the explicit structured-order boundary; a
  // file-backed JSON correction remains evidence-audited as a receipt.
  const structuredPastedOrder = manualSubmission && !importFile.storage_path;

  const [documentResult, categoriesResult, productsResult, familiesResult, variantsResult] =
    await Promise.all([
      manualSubmission
        ? Promise.resolve({ data: null, error: null })
        : db.storage.from(BUCKET).download(importFile.storage_path!),
      db.from('categories').select('name'),
      db.from('products').select('name').limit(50),
      db.from('product_families').select('id, name_uk, name_en, name_de').order('id'),
      db.from('product_variants').select('id, family_id, name_uk, name_en, name_de').order('id'),
    ]);
  if (!manualSubmission && (documentResult.error || !documentResult.data)) {
    throw new Error('Stored document download failed');
  }
  if (categoriesResult.error) throw new Error('Category lookup failed');

  const categories = (categoriesResult.data ?? []).map((row) => row.name);
  const taxonomy: ProductTaxonomyContext =
    familiesResult.error || variantsResult.error
      ? EMPTY_PRODUCT_TAXONOMY
      : { families: familiesResult.data ?? [], variants: variantsResult.data ?? [] };
  const ctx: AiContext = {
    categories,
    products: productsResult.error ? [] : (productsResult.data ?? []),
    taxonomy,
    mimeType: importFile.mime_type,
  };
  const base64 = documentResult.data
    ? bytesToBase64(new Uint8Array(await documentResult.data.arrayBuffer()))
    : '';
  return {
    importFile,
    manualSubmission,
    structuredPastedOrder,
    categories,
    taxonomy,
    ctx,
    base64,
  };
}
