import { z } from 'zod';
import {
  PackagedProductImportSchema,
  normalizeBarcode,
  packagedProductFromImport,
  type PackagedProductImport,
} from '@finance-tracker/domain';
import { parseJsonText } from '@/shared/utils/parse-json-text';
import { formatZodIssues } from '@/shared/utils/format-zod-issues';
import { toPackagedProductCandidates } from './packaged-product-candidates';
import {
  normalizeCatalogueName,
  validatePackagedProductImport,
} from './validate-packaged-product-import';
import type { PromptTaxonomy } from './build-packaged-product-prompt';
import type { PackagingCandidateRow } from '../types';

export const MAX_IMPORT_PRODUCTS = 50;
export const MAX_PDF_PAGES = 100;

const PageNumber = z.number().int().min(1).max(MAX_PDF_PAGES);
const PageReference = z
  .object({
    page: PageNumber,
    kind: z.enum(['front', 'back', 'nutrition', 'ingredients', 'barcode', 'other']),
  })
  .strict();
const ReceiptHint = z
  .object({
    store: z.string().trim().min(1),
    receipt_label: z.string().trim().min(1),
    store_product_code: z.string().nullable().optional(),
    receipt_date: z.iso.date().nullable().optional(),
    receipt_page: PageNumber.nullable().optional(),
  })
  .strict();
const Evidence = z.object({
  source_pages: z.array(PageReference).max(MAX_PDF_PAGES).default([]),
  receipt_matches: z.array(ReceiptHint).max(50).default([]),
});
// What the transcriber read at the top and bottom of the receipt page. It only feeds
// the «this receipt may already exist» warning; the receipt itself is parsed by the
// import queue, never from these values. Unknown keys are dropped, not rejected.
const ReceiptSummary = z.object({
  store: z.string().trim().min(1).nullish(),
  date: z.iso.date().nullish(),
  total: z.number().finite().positive().nullish(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
});

export type PackagingPageReference = z.infer<typeof PageReference>;
export type PackagingReceiptHint = z.infer<typeof ReceiptHint>;
export type PackagingReceiptSummary = {
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
};
export type ExistingPackagingIdentity = { id: string; name: string; barcode: string | null };
export type ImportedPackagedProduct = {
  parsed: PackagedProductImport;
  raw: unknown;
  source_pages: PackagingPageReference[];
  receipt_matches: PackagingReceiptHint[];
  existing_product_id: string | null;
  /** Only populated by the person's explicit choices on the review screen. */
  link_product_ids: string[];
};
export type PackagingImport = {
  products: ImportedPackagedProduct[];
  receipt_pages: number[];
  /** Optional description of the receipt on `receipt_pages`; null when absent or empty. */
  receipt: PackagingReceiptSummary | null;
  warnings: string[];
};

export function parsePackagingImport(
  text: string,
  context: {
    categories: string[];
    taxonomy: PromptTaxonomy;
    existing: ExistingPackagingIdentity[];
  },
): PackagingImport {
  const value: unknown = parseJsonText(text);
  const envelope =
    value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (envelope?.schema_version != null && envelope.schema_version !== 1) {
    throw new Error('Непідтримувана версія JSON. Використай актуальний запит для ШІ.');
  }
  const receipts = z.array(PageNumber).default([]).safeParse(envelope?.receipt_pages);
  if (!receipts.success) throw new Error('receipt_pages: очікується масив номерів сторінок від 1.');
  if (new Set(receipts.data).size !== receipts.data.length)
    throw new Error('Сторінки чека повторюються.');
  const summary = ReceiptSummary.nullish().safeParse(envelope?.receipt);
  if (!summary.success) throw new Error(`receipt: ${formatZodIssues(summary.error)}`);
  const receipt: PackagingReceiptSummary | null =
    summary.data &&
    (summary.data.store != null || summary.data.date != null || summary.data.total != null)
      ? {
          store: summary.data.store ?? null,
          date: summary.data.date ?? null,
          total: summary.data.total ?? null,
          currency: summary.data.currency ?? null,
        }
      : null;
  const candidates = toPackagedProductCandidates(value);
  if (candidates.length === 0 || candidates.length > MAX_IMPORT_PRODUCTS) {
    throw new Error(`JSON має містити від 1 до ${String(MAX_IMPORT_PRODUCTS)} товарів.`);
  }
  const usedPages = new Set(receipts.data);
  const identities = new Set<string>();
  const warnings: string[] = [];
  const products = candidates.map((raw, index): ImportedPackagedProduct => {
    const label = `Товар ${String(index + 1)}`;
    const parsed = PackagedProductImportSchema.safeParse(raw);
    const evidence = Evidence.safeParse(raw);
    if (!parsed.success) throw new Error(`${label}: ${formatZodIssues(parsed.error)}`);
    if (!evidence.success) throw new Error(`${label}: ${formatZodIssues(evidence.error)}`);
    for (const ref of evidence.data.source_pages) {
      if (usedPages.has(ref.page)) {
        throw new Error(
          `Сторінка ${String(ref.page)} використана повторно або позначена як чек. Одна сторінка упаковки має належати одному товару.`,
        );
      }
      usedPages.add(ref.page);
    }
    for (const hint of evidence.data.receipt_matches) {
      if (hint.receipt_page != null && !receipts.data.includes(hint.receipt_page)) {
        throw new Error(`${label}: receipt_page має бути в переліку receipt_pages.`);
      }
    }
    const barcode =
      parsed.data.barcode == null ? null : normalizeBarcode(String(parsed.data.barcode)) || null;
    const identity = barcode
      ? `barcode:${barcode}`
      : `name:${normalizeCatalogueName(parsed.data.name)}`;
    if (identities.has(identity))
      throw new Error(`${label}: товар або штрихкод повторюється в цій же вставці.`);
    identities.add(identity);
    const existing = context.existing.find((row) =>
      barcode
        ? row.barcode === barcode
        : row.barcode == null &&
          normalizeCatalogueName(row.name) === normalizeCatalogueName(parsed.data.name),
    );
    const validation = validatePackagedProductImport(parsed.data, {
      categories: context.categories,
      families: context.taxonomy.families,
      variants: context.taxonomy.variants,
      existingByBarcode: new Map(),
      existingNamesWithoutBarcode: new Map(),
    });
    if (validation.errors.length) throw new Error(`${label}: ${validation.errors.join('; ')}`);
    // Check the persisted contract before rendering or uploading any document.
    packagedProductFromImport(parsed.data, { import_source: 'manual-json' });
    warnings.push(...validation.warnings.map((warning) => `${label}: ${warning}`));
    return {
      parsed: parsed.data,
      raw,
      ...evidence.data,
      existing_product_id: existing?.id ?? null,
      link_product_ids: [],
    };
  });
  return { products, receipt_pages: receipts.data, receipt, warnings };
}

export function validatePackagingPages(batch: PackagingImport, pageCount: number | null): void {
  const referenced = [
    ...batch.receipt_pages,
    ...batch.products.flatMap((product) => product.source_pages.map((ref) => ref.page)),
  ];
  if (pageCount == null) {
    if (referenced.length)
      throw new Error('JSON посилається на сторінки. Додай той самий PDF перед збереженням.');
    return;
  }
  if (batch.products.some((product) => product.source_pages.length === 0)) {
    throw new Error(
      'Для кожного товару в PDF потрібен source_pages. Для імпорту лише текстових карток прибери PDF.',
    );
  }
  if (referenced.some((page) => page > pageCount)) {
    throw new Error(
      `JSON посилається на сторінку, якої немає у PDF (${String(pageCount)} сторінок).`,
    );
  }
}

/**
 * What of a store row a hint can be compared with: a queue row, or a store label
 * already linked to a card.
 */
export type ReceiptHintTarget = Pick<
  PackagingCandidateRow,
  'store' | 'store_product_code' | 'product_name' | 'receipt_labels'
>;

/**
 * The AI's receipt hints as stored on a card created by an import
 * (`raw_import_json.product.receipt_matches`); anything that no longer fits the
 * contract is skipped rather than failing the card page.
 */
export function receiptHintsFromRawImport(raw: unknown): PackagingReceiptHint[] {
  const product =
    raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>).product : null;
  const matches =
    product != null && typeof product === 'object'
      ? (product as Record<string, unknown>).receipt_matches
      : null;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((match) => {
    const parsed = ReceiptHint.safeParse(match);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Date is deliberately excluded: a date alone is never identity evidence. */
export function matchesReceiptHint(
  candidate: ReceiptHintTarget,
  hints: PackagingReceiptHint[],
): boolean {
  const norm = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  return hints.some(
    (hint) =>
      norm(hint.store) === norm(candidate.store) &&
      ((hint.store_product_code != null &&
        hint.store_product_code === candidate.store_product_code) ||
        [candidate.product_name, ...candidate.receipt_labels].some(
          (name) => norm(name) === norm(hint.receipt_label),
        )),
  );
}

export function validatePackagingLinks(products: ImportedPackagedProduct[]): void {
  const seen = new Set<string>();
  for (const product of products) {
    for (const id of product.link_product_ids) {
      if (seen.has(id))
        throw new Error('Одну магазинну позицію не можна прив’язати до двох товарів.');
      seen.add(id);
    }
  }
}
