// The prompt the user copies into an external AI session together with photos of
// a package. This is the main data-entry path for the catalogue, so the wording
// carries most of the data quality: every rule here exists because getting it
// wrong silently produces a plausible-looking but false nutrition record.

import { EU_ALLERGENS } from '@finance-tracker/domain';
import type { PackagingCandidateRow } from '../types';

export type PromptTaxonomy = {
  families: { id: string; name_uk: string; name_de: string }[];
  variants: { id: string; family_id: string; name_uk: string; name_de: string }[];
};

// Caps so the assembled prompt stays pasteable. The receipts dialog caps product
// hints at 50 for the same reason; a truncated prompt is worse than a narrow one.
export const FAMILY_HINT_LIMIT = 200;
export const VARIANT_HINT_LIMIT = 200;

export const EXAMPLE_PACKAGED_PRODUCT_JSON = `{
  "schema_version": 1,
  "receipt_pages": [1],
  "products": [{
  "name": "Pringles Original 165 г",
  "brand": "Pringles",
  "barcode": "5053990101658",
  "category": "Снеки",
  "product_family_id": "chips",
  "product_variant_id": null,
  "is_organic": false,
  "package_size": 165,
  "package_unit": "g",
  "package_count": null,
  "serving_size": 30,
  "nutrition_basis": "per_100_g",
  "energy_kj": 2180,
  "energy_kcal": 523,
  "fat_g": 31.0,
  "saturated_fat_g": 2.9,
  "carbohydrate_g": 52.0,
  "sugars_g": 2.4,
  "fibre_g": 3.1,
  "protein_g": 4.2,
  "salt_g": 1.3,
  "nutri_score": "D",
  "allergens": ["gluten"],
  "allergen_traces": ["milk"],
  "ingredients_text": "Kartoffelflocken, Pflanzenöle (Sonnenblume, Mais), Maismehl",
  "notes": null,
  "source_pages": [{"page": 2, "kind": "front"}, {"page": 3, "kind": "back"}],
  "receipt_matches": [{"store": "REWE", "receipt_label": "Originals", "store_product_code": null, "receipt_date": null, "receipt_page": 1}]
  }]
}`;

function candidateHint(candidate: PackagingCandidateRow): string[] {
  const labels =
    candidate.receipt_labels.length > 0 ? candidate.receipt_labels : [candidate.product_name];
  const printed = labels.map((label) => `"${label}" у ${candidate.store}`).join(', ');
  return [
    '',
    `Цей товар уже відомий із чеків як: ${printed}.`,
    'Використай це лише щоб пересвідчитися, що описуєш той самий товар.',
    'Усі значення все одно бери з фотографій, а не з цих назв.',
  ];
}

export function buildPackagedProductPrompt(
  categories: string[],
  taxonomy: PromptTaxonomy,
  candidate?: PackagingCandidateRow | null,
): string {
  const categoryList = categories.length > 0 ? categories.join(', ') : 'Немає доступних категорій';
  const familyList = taxonomy.families
    .slice(0, FAMILY_HINT_LIMIT)
    .map((f) => `${f.id} — ${f.name_uk} / ${f.name_de}`)
    .join('; ');
  const variantList = taxonomy.variants
    .slice(0, VARIANT_HINT_LIMIT)
    .map((v) => `${v.id} (сімейство ${v.family_id}) — ${v.name_uk} / ${v.name_de}`)
    .join('; ');

  return [
    'Проаналізуй PDF із чеком та фотографіями упаковок одного або кількох товарів і поверни лише валідний JSON.',
    'Без markdown, без коментарів, без пояснень.',
    'Фото можуть містити лицевий бік, зворот, таблицю харчової цінності, склад і штрихкод,',
    'зокрема сторінками одного PDF.',
    'Поверни один обʼєкт schema_version: 1, receipt_pages та products, як у прикладі нижче.',
    '',
    'JSON має відповідати цій формі:',
    EXAMPLE_PACKAGED_PRODUCT_JSON,
    '',
    'Правила PDF та відповідностей:',
    '- receipt_pages: фактичні номери сторінок із чеком, або [] якщо чека немає.',
    '- Нумерація ВСІХ сторінок починається з 1, включно з чеком, обкладинкою та порожніми сторінками.',
    '- source_pages кожного товару: лише сторінки його упаковки, з page та kind:',
    '  front | back | nutrition | ingredients | barcode | other. На одну сторінку — один kind.',
    '- Якщо зворот містить і склад, і таблицю харчової цінності, постав kind: "back" один раз.',
    '- Одна сторінка упаковки належить лише одному товару. Не використовуй receipt_pages як source_pages.',
    '- Різні боки тієї самої упаковки обʼєднай в один товар. Різні смаки й розміри — окремі товари.',
    '- Не копіюй номери сторінок або штрихкод із прикладу: перелічуй лише те, що є у вкладенні.',
    '- Якщо одна сторінка містить кілька різних товарів, не призначай її навмання. Залиш source_pages: []',
    '  та поясни в notes, що потрібно рознести фото на окремі сторінки. Імпорт такого PDF потребує виправлення.',
    '- receipt_matches: необовʼязкові ПРИПУЩЕННЯ про відповідність назви в чеку упаковці.',
    '  store — надрукований магазин; receipt_label — ДОСЛІВНИЙ текст позиції, навіть "Originals";',
    '  store_product_code — лише надрукований код або null; receipt_date — надрукована дата YYYY-MM-DD або null;',
    '  receipt_page — сторінка з цією позицією з receipt_pages або null, якщо це надана підказка з бази.',
    '- Якщо звʼязок сумнівний, залиш receipt_matches: []. Ніколи не вигадуй ID товарів чи чеків.',
    '- Збіг дати чи перебування в одному PDF — лише додатковий контекст, а не доказ відповідності.',
    '  Дата створення/експорту PDF не є датою зйомки або покупки. Не підміняй одну іншою.',
    '- Дані чека тут потрібні лише для зіставлення; не додавай фінансові рядки як картки упаковок.',
    '- Для окремих фото без PDF поверни receipt_pages: [], source_pages: []; фото можна додати в картку пізніше.',
    '',
    'Правила транскрибування:',
    '- Бери значення з упаковки. Не згадуй товар із памʼяті, не шукай його в інших джерелах,',
    '  не обчислюй те, що не надруковано. Якщо чогось не надруковано або не видно — null.',
    '  null завжди кращий за здогад.',
    '- name: повна зрозуміла назва для каталогу: бренд + назва + смак/різновид + нетто,',
    '  наприклад "Pringles Original 165 г". Одиницю в назві пиши українською (г, кг, мл, л).',
    '- brand: лише торгова марка, наприклад "Pringles". null для власних марок магазину,',
    '  де бренд не надруковано.',
    '- barcode: цифри під штрихкодом, лише цифри, без пробілів і дефісів. Перечитай кожну',
    '  цифру двічі: одна помилкова цифра вказує на зовсім інший товар. null, якщо штрихкод',
    '  не потрапив на фото.',
    '',
    'Правила розміру упаковки:',
    '- package_size + package_unit: нетто з лицевого боку, одним числом і однією з одиниць',
    '  pcs | g | kg | ml | l. Для "165 g" → 165 і "g".',
    '- Для мультипаку "4 × 125 g": package_size 500, package_unit "g", package_count 4.',
    '  Для одинарної упаковки package_count = null.',
    '- serving_size: розмір порції, до якої привʼязана таблиця харчової цінності, у тій самій',
    '  одиниці, що й package_unit; null, якщо порція не надрукована.',
    '',
    'Правила харчової цінності:',
    '- nutrition_basis: "per_100_g" або "per_100_ml" — та колонка надрукованої таблиці,',
    '  з якої ти взяв числа.',
    '- Бери ЛИШЕ колонку на 100 г / 100 мл. Якщо етикетка друкує значення тільки на порцію —',
    '  постав nutrition_basis: null, усі нутрієнти null, а в notes напиши, що саме надруковано',
    '  (наприклад "на етикетці лише на порцію 30 г"). НІКОЛИ не перераховуй порцію в 100 г.',
    '- Лише числа, десяткова крапка, без одиниць і без "<" чи "≈": "< 0,5 g" → 0.5,',
    '  "0,001 g" → 0.001. Для німецьких етикеток заміни кому на крапку.',
    '- energy_kj і energy_kcal обидва з рядка енергії ("Energie 2180 kJ / 523 kcal").',
    '- fat_g = "Fett", saturated_fat_g = "davon gesättigte Fettsäuren",',
    '  carbohydrate_g = "Kohlenhydrate", sugars_g = "davon Zucker",',
    '  fibre_g = "Ballaststoffe", protein_g = "Eiweiß", salt_g = "Salz".',
    '- saturated_fat_g не може перевищувати fat_g, а sugars_g не може перевищувати',
    '  carbohydrate_g. Якщо так вийшло — перечитай таблицю.',
    '- nutri_score: одна літера A–E, лише якщо логотип Nutri-Score надрукований на упаковці.',
    '  Ніколи не рахуй його сам. Інакше null.',
    '',
    'Правила складу й алергенів:',
    '- ingredients_text: повний склад дослівно, мовою упаковки, одним рядком.',
    '  Збережи відсотки й дужки. null, якщо склад не сфотографовано.',
    '- allergens: складники, які етикетка декларує як алергени (зазвичай жирним або після',
    `  "Enthält"). Лише ці ключі: ${EU_ALLERGENS.join(', ')}.`,
    '  Порожній масив, якщо нічого не задекларовано.',
    '- allergen_traces: ті самі ключі, але для "Kann Spuren von … enthalten" /',
    '  "може містити сліди". Порожній масив, якщо такого напису немає.',
    '',
    'Правила класифікації:',
    '- category: рівно одне значення зі списку нижче. Не вигадуй категорій.',
    '- product_family_id / product_variant_id: рівно один id зі списків нижче, або null.',
    '  Варіант можна вживати лише разом із його власним сімейством.',
    '- is_organic: true лише якщо на упаковці є сертифікація Bio/organic; false для явно',
    '  звичайного харчового товару; null, коли визначити неможливо.',
    ...(candidate ? candidateHint(candidate) : []),
    '',
    `Дозволені категорії: ${categoryList}`,
    familyList ? `Сімейства товарів (id — назва): ${familyList}` : 'Сімейства товарів: не надано.',
    variantList ? `Варіанти товарів (id — назва): ${variantList}` : 'Варіанти товарів: не надано.',
  ].join('\n');
}
