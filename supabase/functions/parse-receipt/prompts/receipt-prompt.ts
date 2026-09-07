// Core receipt-extraction rules originated in legacy `Gemini._buildPrompt`.
// Both active providers use this one prompt + schema, preventing drift on
// load-bearing rules (negative rows, allowed categories and taxonomy).
//
// Product taxonomy is deliberately active-app only: legacy is a frozen
// rollback reference and cannot represent the current nullable fields.

import type { AiContext } from '../types.ts';

export function buildPrompt(ctx: AiContext): string {
  const categories = (ctx.categories ?? []).join(', ');
  const productHints = (ctx.products ?? [])
    .slice(0, 50)
    .map((p) => p.name)
    .join(', ');
  const taxonomyHints = formatTaxonomyHints(ctx);
  return [
    'Extract receipt line items from this image.',
    '',
    'Return JSON conforming to the response schema. Rules:',
    '- product_name: copy verbatim as printed on the receipt; do not translate or normalize.',
    '- product_code: numeric/alphanumeric per-line article number printed BEFORE the product name (e.g. Aldi prints "297855 Multivitamin 1l 1,39"; here product_code="297855"). Copy verbatim, no leading zeros stripped. Set null if no per-line code is printed (many smaller stores have none). Do NOT use receipt-level numbers like TA-Nr / Beleg-Nr / barcodes.',
    '- qty: numeric quantity, always POSITIVE (strictly > 0). Three cases: (a) count-based item printed with a multiplier like "x 2" or "2x" — qty equals that count (e.g. "EIFEL Eier Fl. 3,89 € x 2" → qty=2, unit_price_orig=3.89); (b) weight- or volume-based item printed with a "kg × EUR/kg", "g × EUR/kg", "l × EUR/l" line beneath the product — qty equals the printed weight/volume (FRACTIONAL VALUES ARE EXPECTED AND REQUIRED here, e.g. "Bananen 0,956 kg × 1,29 EUR/kg = 1,23" → qty=0.956, unit_price_orig=1.29; "Süßkartoffeln 1,432 kg × 2,29 EUR/kg = 3,28" → qty=1.432, unit_price_orig=2.29); (c) plain line with no count/weight printed — qty=1.0. Do NOT round fractional weight up to 1. Do NOT use the line total as unit_price when a per-kg/per-l price is printed — always pair the printed weight with the printed per-unit price.',
    '- A standalone rightmost "1" or "2" aligned as a tax column (for example the MwSt-Satz class on dm receipts) is tax metadata, NEVER quantity. qty may exceed 1 only when the same item row has an explicit multiplier such as "2 x", "x 2", "2 Stk" or a weight/volume calculation.',
    '- Preserve every separately printed financial row in visual top-to-bottom order. Consecutive rows with the same name and price are separate purchases; never collapse or deduplicate them.',
    '- unit_price_orig: numeric price per unit in the receipt currency. For count-based items this is the price for ONE unit (the receipt usually prints this explicitly, e.g. "3,89 € x 2"). For weight/volume items this is the per-kg / per-l price (NOT the total for that weight). CAN BE NEGATIVE for discounts, deposit refunds, and cancellations (see below).',
    '- category_suggestion: one of the listed categories (verbatim) or null if uncertain. Do not invent new categories.',
    '- product_family_id and product_variant_id: classify the actual product only with IDs from the supplied taxonomy. product_variant_id must belong to product_family_id. If the product is clear but no matching variant exists, return the family ID and variant null. If the printed name is truncated, ambiguous, or the taxonomy has no matching family, return both null. Never infer a product from a flavour-only word such as "Original" or "Wings".',
    '- brand: copy a brand only when it is explicitly printed as part of the product identity. A retailer/store (for example Aldi) is not automatically a brand. Return null when the receipt does not establish a brand.',
    '- is_organic: true only when the product itself explicitly says Bio/organic/öko (not words such as Biotin or bioavailable). For an identified FOOD product with no such label, false is allowed. For an ambiguous or non-food item, return null. Missing "Bio" alone is never evidence for a specific product identity.',
    '- store: best-effort store/merchant name; null if illegible.',
    '- store_address: street address printed on receipt header (street, number, city); null if not printed or illegible. Copy as a single line, comma-separated.',
    '- date: receipt date as YYYY-MM-DD; null if illegible.',
    '- A receipt can show two legitimate times: a fiscal cash-register sale time and a later/earlier card-payment authorization time. Extract BOTH separately whenever they are printed. Never use a filename, PDF creation metadata, phone status bar, or an inferred time.',
    '- fiscal_time: the time of the fiscal cash-register sale as HH:MM (24-hour, no seconds), or null. Prefer fields such as a register/fiscal receipt timestamp, "Datum Uhrzeit Filiale Pos Bed Bon", TSE transaction time, or an "Einkauf vom" purchase header. fiscal_time_raw_text must copy the shortest complete visible text that proves it.',
    '- payment_time: the card/payment-terminal time as HH:MM (24-hour, no seconds), or null. Examples include a "Kundenbeleg", "Bezahlung", "AS-Zeit", terminal or card-authorization timestamp. payment_time_raw_text must copy the shortest complete visible text that proves it.',
    '- time: canonical purchase time as HH:MM. It MUST equal fiscal_time when fiscal_time is present; otherwise it may equal payment_time. Set time to null only when neither printed timestamp is readable.',
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
    'Final reminder: qty stays POSITIVE even on negative-price rows — only the price flips sign. Do not invent items not visible on the receipt; do not net out cancellations. Never add a balancing or rounding item merely to match the final total.',
    '',
    `Allowed categories: ${categories}`,
    taxonomyHints,
    productHints
      ? `\nKnown product names from prior purchases (hint only — do not force a match): ${productHints}`
      : '',
  ].join('\n');
}

export function buildSchema(ctx: AiContext): Record<string, unknown> {
  const categoryEnum = [...(ctx.categories ?? []), null];
  const taxonomy = ctx.taxonomy ?? { families: [], variants: [] };
  const familyEnum = [...taxonomy.families.map((family) => family.id), null];
  const variantEnum = [...taxonomy.variants.map((variant) => variant.id), null];
  return {
    type: 'object',
    properties: {
      store: { type: ['string', 'null'] },
      store_address: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      time: { type: ['string', 'null'], description: 'HH:MM (24-hour)' },
      fiscal_time: {
        type: ['string', 'null'],
        description: 'Fiscal cash-register sale time, HH:MM (24-hour), or null.',
      },
      fiscal_time_raw_text: {
        type: ['string', 'null'],
        description: 'Visible text proving fiscal_time, or null.',
      },
      payment_time: {
        type: ['string', 'null'],
        description: 'Card/payment-terminal time, HH:MM (24-hour), or null.',
      },
      payment_time_raw_text: {
        type: ['string', 'null'],
        description: 'Visible text proving payment_time, or null.',
      },
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
            product_family_id: { type: ['string', 'null'], enum: familyEnum },
            product_variant_id: { type: ['string', 'null'], enum: variantEnum },
            brand: { type: ['string', 'null'] },
            is_organic: { type: ['boolean', 'null'] },
          },
          required: [
            'product_name',
            'qty',
            'unit_price_orig',
            'product_family_id',
            'product_variant_id',
            'brand',
            'is_organic',
          ],
        },
      },
    },
    required: [
      'currency',
      'items',
      'fiscal_time',
      'fiscal_time_raw_text',
      'payment_time',
      'payment_time_raw_text',
    ],
  };
}

function formatTaxonomyHints(ctx: AiContext): string {
  const taxonomy = ctx.taxonomy ?? { families: [], variants: [] };
  if (taxonomy.families.length === 0) {
    return 'Product taxonomy: none supplied. Set product_family_id and product_variant_id to null.';
  }
  const families = taxonomy.families
    .map((family) => `${family.id} = ${family.name_uk} / ${family.name_de}`)
    .join('; ');
  const variants = taxonomy.variants.length
    ? taxonomy.variants
        .map(
          (variant) =>
            `${variant.id} (${variant.family_id}) = ${variant.name_uk} / ${variant.name_de}`,
        )
        .join('; ')
    : 'none';
  return `Allowed product taxonomy (IDs must match exactly). Families: ${families}\nVariants: ${variants}`;
}
