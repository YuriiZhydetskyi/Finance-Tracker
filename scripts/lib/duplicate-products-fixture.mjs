// A synthetic but realistic data set for the canonical-stores migrations: the same
// shapes the production dump showed (spelling twins of one chain, a chain printed
// with franchise operators, code-based and name-based duplicates, a purchase
// imported twice, conflicting classifications), with invented names throughout.
// Loaded with triggers off so every snapshot lands exactly as written here.

import { ULID } from './pglite-app-schema.mjs';

export const pid = (n) => ULID(`P${n}`);
export const rid = (n) => ULID(`R${n}`);
export const iid = (n) => ULID(`I${n}`);
export const PP = { one: ULID('PPONE'), two: ULID('PPTWO'), three: ULID('PPTHREE') };

const CATEGORIES = [
  ['Молочка', 'Продукти'],
  ['Бакалія', 'Продукти'],
  ['Солодке', 'Продукти'],
  ['Овочі/фрукти', 'Продукти'],
  ['М’ясо/риба', 'Продукти'],
  ['Хімія/гігієна', 'Побут'],
  ['Одяг', 'Побут'],
  ['Авто', 'Транспорт'],
  ['Інше', 'Інше'],
  ['Pfand', 'Інше'],
];

// [number, store, code, name, category, extra]
// extra: { pp, na, naReason, family, variant, brand, organic, created }
const PRODUCTS = [
  // ── tier 1: same canonical store, same code ────────────────────────────
  [1, 'ALDI SÜD', '111111', 'Bio Knusperriegel', 'Солодке', { pp: PP.one }],
  [2, 'Aldi Süd', '111111', 'Bio Knusperriegel', 'Солодке', { pp: PP.one }],
  [3, 'ALDI SÜD', '222222', 'Süßkartoffeln', 'Овочі/фрукти', {}],
  [4, 'Aldi Süd', '222222', 'Süßkartoffeln', 'Овочі/фрукти', {}],
  [5, 'ALDI SÜD', '333333', 'Vollkorn-Sandwich', 'Бакалія', { family: 'bread' }],
  [6, 'Aldi Süd', '333333', 'Vollkorn-Sandwich', 'Бакалія', { family: 'sandwich_bread' }],
  [7, 'ALDI SÜD', '444444', 'Joghurt', 'Молочка', { pp: PP.one }],
  [8, 'Aldi Süd', '444444', 'Joghurt', 'Молочка', { pp: PP.two }],
  [9, 'ALDI SÜD', '555555', 'Mix', 'Бакалія', {}],
  [10, 'Aldi Süd', '555555', 'Mix', 'Солодке', {}],
  [11, 'ALDI SÜD', '712962', 'Lachsseite XXL', 'М’ясо/риба', { pp: PP.three }],
  [12, 'Aldi Süd', '712962', 'Lachseite XXL', 'М’ясо/риба', {}],
  [13, 'Aldi Süd', '999999', 'Nur Aldi Süd', 'Бакалія', {}],
  [14, 'Aldi', null, 'Brötchen', 'Бакалія', {}],
  [15, 'ALDI SÜD', '777777', 'Dreifach', 'Бакалія', {}],
  [16, 'Aldi Süd', '777777', 'Dreifach', 'Бакалія', {}],
  [17, 'Aldi', '777777', 'Dreifach', 'Бакалія', {}],
  [18, 'ALDI SÜD', '888888', 'Milch', 'Молочка', { family: 'milk' }],
  [19, 'Aldi Süd', '888888', 'Milch', 'Молочка', { family: 'milk', variant: 'whole_milk' }],
  [20, 'ALDI SÜD', '121212', 'Eier', 'Молочка', { na: true }],
  [21, 'Aldi Süd', '121212', 'Eier', 'Молочка', { pp: PP.three }],
  // different codes are different articles: never touched
  [22, 'ALDI SÜD', '80000291', 'Pfand', 'Pfand', {}],
  [23, 'ALDI SÜD', '80000472', 'Pfand', 'Pfand', {}],
  [24, 'ALDI SÜD', '309604', 'Cocktailtom. 500g', 'Овочі/фрукти', {}],
  [25, 'ALDI SÜD', '309602', 'Cocktailtom. 500g', 'Овочі/фрукти', {}],
  // ── tier 2: same canonical store, same name, no code ───────────────────
  [30, 'Netto', null, 'Quarki Quark FK 250g', 'Молочка', {}],
  [31, 'Netto Marken-Discount', null, 'Quarki Quark FK 250g', 'Молочка', {}],
  [32, 'Netto', null, 'Aepfel 2kg VKE QS', 'Овочі/фрукти', {}],
  [33, 'Netto Marken-Discount', null, 'Aepfel 2kg VKE QS', 'Овочі/фрукти', {}],
  [34, 'Netto', null, 'Knotenbeutel', 'Інше', {}],
  [35, 'Netto Marken-Discount', null, 'Knotenbeutel', 'Інше', {}],
  [40, 'EDEKA Musterstadt', null, 'EIFEL Eier FLH', 'Молочка', {}],
  [41, 'EDEKA Musterstadt', null, 'EIFEL Eier FlH', 'Молочка', {}],
  [42, 'EDEKA Musterstadt', null, 'Gut Beispiel Eier FLH', 'Молочка', {}],
  [43, 'Marktkauf Musterstadt', null, 'Gut Beispiel Eier FLH', 'Молочка', {}],
  [44, 'EDEKA Musterstadt', null, 'Leergut Einw.allg.', 'Pfand', {}],
  [45, 'EDEKA Musterstadt', null, 'Leergut Entl.allg.', 'Pfand', {}],
  [50, 'REWE Müller oHG', null, 'PFAND 0,15 EUR', 'Pfand', {}],
  [51, 'Beispiel Markt GmbH & Co KG (REWE Beispiel)', null, 'PFAND 0,15 EUR', 'Pfand', {}],
  [52, 'REWE', null, 'CHERRYROMATOMATE', 'Овочі/фрукти', {}],
  [53, 'REWE Müller oHG', null, 'CHERRYROMATOMATE', 'Овочі/фрукти', {}],
  [60, 'AVEX', null, 'Super SB', 'Авто', {}],
  [61, 'AVEX Beispiel BTS GmbH', null, 'Super SB', 'Авто', {}],
  [62, 'AVEX Tankstelle Beispieldorf', null, 'Super SB', 'Авто', {}],
  [70, 'ORLEN', null, 'Super (B)D(5)', 'Авто', {}],
  [71, 'ORLEN S.A.', null, 'Super (3)', 'Авто', {}],
  // ── exclusion-rule probes ──────────────────────────────────────────────
  [80, 'REWE', null, 'Tragetasche', 'Інше', {}],
  [81, 'REWE', null, 'Bananen', 'Овочі/фрукти', {}],
  [82, 'REWE', null, 'Äpfel Schale', 'Овочі/фрукти', {}],
  [83, 'REWE', null, 'Duschgel', 'Хімія/гігієна', {}],
  [84, 'REWE', null, 'T-Shirt', 'Одяг', {}],
  [85, 'REWE', null, 'Halb gewogen', 'Бакалія', {}],
  [86, 'REWE', null, 'Selten gewogen', 'Бакалія', {}],
  [87, 'REWE', null, 'Von Hand markiert', 'Бакалія', { na: true }],
  [88, 'REWE', null, 'Mit Karte', 'Бакалія', { pp: PP.two }],
  // Weighed pre-packed meat keeps its card path (barcode null, identity by name).
  [89, 'REWE', null, 'Schweinefilet', 'М’ясо/риба', {}],
];

// [number, store, date, extra]
const RECEIPTS = [
  [1, 'ALDI SÜD', '2026-05-01'],
  [2, 'ALDI SÜD', '2026-06-01'],
  [3, 'ALDI SÜD', '2026-07-01'],
  [4, 'Aldi Süd', '2026-10-15'],
  [5, 'Aldi Süd', '2026-10-17'],
  [6, 'Aldi', '2026-05-13'],
  [7, 'Netto', '2026-05-16'],
  [8, 'Netto Marken-Discount', '2026-05-16'],
  [9, 'EDEKA Musterstadt', '2026-05-02'],
  [10, 'Marktkauf Musterstadt', '2026-05-03'],
  [11, 'REWE Müller oHG', '2026-05-04'],
  [12, 'Beispiel Markt GmbH & Co KG (REWE Beispiel)', '2026-05-05'],
  [13, 'REWE', '2026-05-06'],
  [14, 'AVEX', '2026-05-07'],
  [15, 'AVEX Beispiel BTS GmbH', '2026-05-08'],
  [16, 'AVEX Tankstelle Beispieldorf', '2026-05-09'],
  [17, 'ORLEN', '2026-05-10'],
  [18, 'ORLEN S.A.', '2026-05-11'],
  [19, 'Amazon.de', '2026-05-12', { order: '305-1234567-7654321' }],
  [20, 'AMAZON.DE', '2026-05-12', { order: '305-1234567-7654321' }],
];

// purchases: [productNumber, receiptNumber, qty, unitPrice, snapshot?]
// snapshot = [family, variant] pins the item's own taxonomy snapshot (null = none).
const PURCHASES = [
  [1, 1, 1, 1.19],
  [1, 2, 1, 1.19],
  [1, 3, 1, 1.19],
  [2, 4, 1, 1.19],
  [3, 1, 0.67, 1.99],
  [3, 2, 1.32, 1.99],
  [4, 4, 0.9, 1.99],
  [5, 1, 1, 2.49],
  [5, 2, 1, 2.49],
  [6, 4, 1, 2.49],
  [7, 1, 1, 0.99],
  [8, 4, 1, 0.99],
  [9, 1, 1, 1.5],
  [10, 4, 1, 1.5],
  [11, 1, 1, 7.99],
  [11, 2, 1, 7.99],
  [11, 3, 1, 8.49],
  [12, 4, 1, 8.49],
  [13, 4, 1, 0.5],
  [14, 6, 1, 0.3],
  [15, 1, 1, 1],
  [15, 2, 1, 1],
  [16, 4, 1, 1],
  [17, 6, 1, 1],
  [18, 1, 1, 1.09, ['milk', null]],
  [18, 2, 1, 1.09, ['milk', null]],
  [19, 4, 1, 1.19, ['milk', 'whole_milk']],
  [19, 5, 1, 1.19, ['milk', null]],
  [20, 1, 1, 3.29],
  [21, 4, 1, 3.29],
  [22, 1, 1, 0.25],
  [22, 2, 1, 0.25],
  [22, 3, 1, 0.25],
  [23, 2, 1, 0.25],
  [23, 3, 1, 0.25],
  [24, 1, 1, 1.39],
  [24, 2, 1, 1.39],
  [25, 2, 1, 0.89],
  [30, 7, 1, 1.29],
  [31, 8, 1, 1.29],
  [32, 7, 1, 2.49],
  [33, 8, 1, 2.49],
  [34, 7, 1, 0.15],
  [35, 8, 1, 0.15],
  [40, 9, 1, 3.89],
  [40, 9, 1, 3.89],
  [40, 9, 1, 3.99],
  [40, 9, 1, 3.99],
  [40, 9, 1, 3.89],
  [41, 9, 1, 3.89],
  [42, 9, 1, 4.99],
  [43, 10, 1, 4.99],
  [44, 9, 1, 0.25],
  [45, 9, 1, 0.25],
  [50, 11, 1, 0.15],
  [50, 11, 2, 0.15],
  [51, 12, 1, 0.15],
  [52, 13, 1, 1.99],
  [53, 11, 1, 1.99],
  [60, 14, 31.57, 1.859],
  [60, 14, 20.12, 1.869],
  [61, 15, 18.4, 1.899],
  [62, 16, 22.3, 1.909],
  [70, 17, 40.5, 1.799],
  [71, 18, 35.2, 1.819],
  [80, 13, 1, 0.39],
  [80, 13, 1, 0.39],
  [81, 13, 0.7, 1.99],
  [81, 13, 1.2, 1.99],
  [82, 13, 1, 2.99],
  [82, 13, 2, 2.99],
  [82, 13, 1, 2.99],
  [83, 13, 1, 2.45],
  [84, 13, 1, 9.99],
  [85, 13, 1, 1],
  [85, 13, 0.5, 1],
  [85, 13, 1, 1],
  [85, 13, 0.25, 1],
  [86, 13, 1, 1],
  [86, 13, 0.5, 1],
  [86, 13, 1, 1],
  [87, 13, 1, 1],
  [88, 13, 1, 1],
  [89, 13, 0.5, 8.99],
  [89, 13, 0.7, 8.99],
];

const round2 = (value) => Math.round(value * 100) / 100;

export async function loadDuplicateProductsFixture(db, { withRules = true } = {}) {
  await db.exec('set session_replication_role = replica');
  for (const [name, group] of CATEGORIES) {
    await db.query('insert into public.categories (name, group_name) values ($1, $2)', [
      name,
      group,
    ]);
  }
  await db.exec(`
    insert into public.product_families values ('bread'), ('sandwich_bread'), ('milk');
    insert into public.product_variants values ('whole_milk', 'milk');
    insert into public.product_variants values ('wholegrain_sandwich_bread', 'sandwich_bread');
    insert into public.app_users (email) values ('a@example.com');
  `);
  for (const id of Object.values(PP)) {
    await db.query(
      'insert into public.packaged_products (id, name, category) values ($1, $1, $2)',
      [id, 'Бакалія'],
    );
  }

  // Older spelling first: created_at decides which spelling the registry remembers.
  let tick = 0;
  const at = () => new Date(Date.UTC(2026, 4, 1, 0, 0, tick++)).toISOString();

  const totals = new Map(RECEIPTS.map((receipt) => [receipt[0], 0]));
  for (const purchase of PURCHASES) {
    const [, receiptNumber, qty, price] = purchase;
    totals.set(receiptNumber, round2(totals.get(receiptNumber) + qty * price));
  }

  for (const [number, store, date, extra] of RECEIPTS) {
    const total = totals.get(number);
    await db.query(
      `insert into public.receipts (id, date, store, currency, total_orig, fx_rate_eur, total_eur,
                                    paid_by, source, merchant_order_id, created_at, updated_at)
       values ($1, $2, $3, 'EUR', $4, 1, $4, 'a@example.com', 'manual', $5, $6, $6)`,
      [rid(number), date, store, total, extra?.order ?? null, at()],
    );
  }

  for (const [number, store, code, name, category, extra] of PRODUCTS) {
    await db.query(
      `insert into public.products (id, name, category, store, store_product_code, product_family_id,
                                    product_variant_id, packaged_product_id, packaging_not_applicable,
                                    created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        pid(number),
        name,
        category,
        store,
        code,
        extra.family ?? null,
        extra.variant ?? null,
        extra.pp ?? null,
        extra.na ?? false,
        at(),
      ],
    );
  }

  const productCategory = new Map(PRODUCTS.map((p) => [p[0], p[4]]));
  const productName = new Map(PRODUCTS.map((p) => [p[0], p[3]]));
  const productTaxonomy = new Map(
    PRODUCTS.map((p) => [p[0], [p[5].family ?? null, p[5].variant ?? null]]),
  );
  let itemNumber = 0;
  let priceNumber = 0;
  for (const [productNumber, receiptNumber, qty, price, snapshot] of PURCHASES) {
    const [family, variant] = snapshot ?? productTaxonomy.get(productNumber);
    const total = round2(qty * price);
    const itemId = iid(++itemNumber);
    await db.query(
      `insert into public.items (id, receipt_id, product_id, product_name, raw_product_name, category,
                                 qty, unit_price_orig, discount_orig, total_orig, total_eur, consumed_by,
                                 product_family_id, product_variant_id)
       values ($1, $2, $3, $4, $4, $5, $6, $7, 0, $8, $8, 'shared', $9, $10)`,
      [
        itemId,
        rid(receiptNumber),
        pid(productNumber),
        productName.get(productNumber),
        productCategory.get(productNumber),
        qty,
        price,
        total,
        family,
        variant,
      ],
    );
    await db.query(
      `insert into public.product_prices (id, product_id, receipt_id, price_orig, price_net, currency, date)
       select $1, $2, $3, $4, $4, 'EUR', r.date from public.receipts r where r.id = $3`,
      [ULID(`PRICE${++priceNumber}`), pid(productNumber), rid(receiptNumber), price],
    );
  }

  if (withRules) {
    await db.query(
      `insert into public.product_match_rules (store_key, raw_product_name_key, product_id, product_name, category)
       values ($1, $2, $3, 'Süßkartoffeln', 'Овочі/фрукти'),
              ($4, $2, $5, 'Süßkartoffeln', 'Овочі/фрукти'),
              ($4, 'brötchen', $6, 'Brötchen', 'Бакалія'),
              ('aldi', 'mix', $7, 'Mix', 'Бакалія'),
              ('aldi süd', 'mix', $8, 'Mix', 'Солодке')`,
      ['aldi süd', 'süßkartoffeln lose', pid(4), 'aldi', pid(3), pid(14), pid(9), pid(10)],
    );
  }
  await db.exec('set session_replication_role = origin');

  return {
    productCount: PRODUCTS.length,
    receiptCount: RECEIPTS.length,
    itemCount: PURCHASES.length,
    ruleCount: withRules ? 5 : 0,
  };
}
