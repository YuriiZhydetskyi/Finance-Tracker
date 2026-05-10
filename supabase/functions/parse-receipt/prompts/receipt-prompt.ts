// Verbatim port of legacy `Gemini._buildPrompt` and `Gemini._buildSchema`.
// Both AI providers (Gemini primary, Anthropic fallback) use the same prompt
// + schema — sharing them prevents drift on load-bearing rules (negative line
// items, allowed-category enum) between the two providers.
//
// If you change the prompt, also update legacy/apps-script/src/Gemini.js so
// the rollback path stays in sync.

import type { AiContext } from '../types.ts';

export function buildPrompt(ctx: AiContext): string {
  const categories = (ctx.categories ?? []).join(', ');
  const productHints = (ctx.products ?? [])
    .slice(0, 50)
    .map((p) => p.name)
    .join(', ');
  return [
    'Extract receipt line items from this image.',
    '',
    'Return JSON conforming to the response schema. Rules:',
    '- product_name: copy verbatim as printed on the receipt; do not translate or normalize.',
    '- product_code: numeric/alphanumeric per-line article number printed BEFORE the product name (e.g. Aldi prints "297855 Multivitamin 1l 1,39"; here product_code="297855"). Copy verbatim, no leading zeros stripped. Set null if no per-line code is printed (many smaller stores have none). Do NOT use receipt-level numbers like TA-Nr / Beleg-Nr / barcodes.',
    '- qty: numeric quantity, always POSITIVE (>= 1). 1.0 if not specified per-line.',
    '- unit_price_orig: numeric price per unit in the receipt currency. CAN BE NEGATIVE for discounts, deposit refunds, and cancellations (see below).',
    '- category_suggestion: one of the listed categories (verbatim) or null if uncertain. Do not invent new categories.',
    '- store: best-effort store/merchant name; null if illegible.',
    '- date: receipt date as YYYY-MM-DD; null if illegible.',
    '- currency: ISO 4217 (e.g. EUR, UAH); default to "EUR" if not visible.',
    '- total_orig: numeric total as printed (the "to pay" / "Zu bezahlen" / "Сума до сплати" line); null if illegible.',
    '',
    'NEGATIVE LINE ITEMS — important and frequently mis-parsed.',
    'Receipts often include rows with a negative price. Always include these as separate items with negative unit_price_orig. NEVER drop them, NEVER merge them with their positive counterpart. Three common cases:',
    '',
    '  1) Cancellation / void: the same product appears at full price and again with a matching NEGATIVE price (the cashier rang it twice, then voided one). Example:',
    '       "Mayb.Rose AF 0,75l   2,99"',
    '       "Mayb.Rose AF 0,75l  -2,99"',
    '     Emit BOTH rows as separate items. Keep product_name identical to the original. category_suggestion: same as the original product.',
    '',
    '  2) Discount / Rabatt / Aktion / near-expiry markdown: a product at full price followed by a negative line for the markdown (sometimes on a line labeled "Rabatt" / "Aktion" / "% Nachlass" / similar). Emit both lines. For the negative line, use product_name as printed (or the original product name if the discount line has no name) and set category_suggestion to the same category as the product it discounts.',
    '',
    '  3) Pfand / Leergut (German bottle deposits): "Pfand" with a POSITIVE price is a deposit charge added when you buy a bottled drink. "Leergut", "Leergut Entl.allg.", "Leergut Einw.allg." with a NEGATIVE price are refunds for returned empty bottles. Emit each as a separate item. If the Allowed categories list contains "Pfand", set category_suggestion="Pfand" for all of these; otherwise leave it null.',
    '',
    'Final reminder: qty stays POSITIVE even on negative-price rows — only the price flips sign. Do not invent items not visible on the receipt; do not net out cancellations.',
    '',
    `Allowed categories: ${categories}`,
    productHints
      ? `\nKnown product names from prior purchases (hint only — do not force a match): ${productHints}`
      : '',
  ].join('\n');
}

export function buildSchema(ctx: AiContext): Record<string, unknown> {
  const categoryEnum = [...(ctx.categories ?? []), null];
  return {
    type: 'object',
    properties: {
      store: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      currency: { type: 'string', description: 'ISO 4217 (default EUR)' },
      total_orig: { type: ['number', 'null'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            product_name: { type: 'string' },
            product_code: { type: ['string', 'null'] },
            qty: { type: 'number' },
            unit_price_orig: { type: 'number' },
            category_suggestion: { type: ['string', 'null'], enum: categoryEnum },
          },
          required: ['product_name', 'qty', 'unit_price_orig'],
        },
      },
    },
    required: ['currency', 'items'],
  };
}
