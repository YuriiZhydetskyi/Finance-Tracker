// The stores the app already knows, as the receipt prompt's spelling hint (ADR-0033).
// They come from two tables: store_name_registry (every store seen, under its
// first-seen spelling) and store_name_patterns (chain aliases such as ALDI SÜD or
// REWE, whose canonical_name is the spelling to use for every operator variant).

type NamedRow = { canonical_name: string };

/** Distinct canonical names from any number of query results, sorted for a stable prompt. */
export function mergeKnownStores(...lists: (readonly NamedRow[] | null | undefined)[]): string[] {
  const names = new Set<string>();
  for (const list of lists) {
    for (const row of list ?? []) {
      const name = row.canonical_name.trim();
      if (name !== '') names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}
