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
    '- qty: numeric quantity, always POSITIVE (strictly > 0). Three cases: (a) count-based item printed with a multiplier like "x 2" or "2x" — qty equals that count (e.g. "EIFEL Eier Fl. 3,89 € x 2" → qty=2, unit_price_orig=3.89); (b) weight- or volume-based item printed with a "kg × EUR/kg", "g × EUR/kg", "l × EUR/l" line beneath the product — qty equals the printed weight/volume (FRACTIONAL VALUES ARE EXPECTED AND REQUIRED here, e.g. "Bananen 0,956 kg × 1,29 EUR/kg = 1,23" → qty=0.956, unit_price_orig=1.29; "Süßkartoffeln 1,432 kg × 2,29 EUR/kg = 3,28" → qty=1.432, unit_price_orig=2.29); (c) plain line with no count/weight printed — qty=1.0. Do NOT round fractional weight up to 1. Do NOT use the line total as unit_price when a per-kg/per-l price is printed — always pair the printed weight with the printed per-unit price.',
    '- unit_price_orig: numeric price per unit in the receipt currency. For count-based items this is the price for ONE unit (the receipt usually prints this explicitly, e.g. "3,89 € x 2"). For weight/volume items this is the per-kg / per-l price (NOT the total for that weight). CAN BE NEGATIVE for discounts, deposit refunds, and cancellations (see below).',
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
    '  2) Discount / Rabatt / Aktion / Preisänderung / near-expiry markdown: a product at full price followed by a negative line for the markdown. Common label words for the negative line: "Rabatt", "Aktion", "Preisänderung", "Nachlass", "% Nachlass", "Treuerabatt", "Coupon", "Sofort-Rabatt", "Promo". Emit both lines. For the negative line, ALWAYS set product_name to the product_name of the row immediately above it (the product being discounted) — NEVER use the discount-label word as product_name, even when it is printed (e.g. on the EDEKA "Preisänderung -1,64" pattern, set product_name to the previous product). Also copy that product\'s category_suggestion onto the negative line. Recap lines that print the resulting net price after the discount — labeled "neuer Preis" / "neuer Preis:" / "new price" / "Endpreis" / "Sie zahlen" — are informational only; SKIP these lines entirely, do NOT emit them as items. IMPORTANT: this product-name-copying rule applies ONLY to the discount labels listed above. Do NOT apply it to Pfand / Leergut lines (case 3) — those are deposit refunds, not discounts of the prior product, even though they also have negative prices. Pfand/Leergut keep their own printed name. If you are unsure whether a negative line is a discount of the prior product or an independent refund, leave its product_name as printed; do not guess.',
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
