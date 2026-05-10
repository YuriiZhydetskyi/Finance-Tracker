// detectPairs v2 — collapse Rabatt-style cancellation/discount pairs AND
// aggregate identical residual rows. See ADR-0012 + ADR-0014 + ADR-0015.
//
// Three-pass algorithm:
//   Pass 1: exact cancellation pairs within a name-group (+X paired with -X
//           where qty matches and totals are equal in absolute value).
//   Pass 2: discount pairs within a name-group (+X paired with -Y where
//           qty matches and pos_total > |neg_total|).
//   Pass 3: orthogonal aggregation across all surviving items, keyed by
//           (normalized_name, unit_price, discount_orig, marker.kind).
//           Identical rows collapse into one with summed qty and count.
//
// Originally a port of legacy/apps-script/src/ui/shared/pairDetector.html;
// extended in 2026-05 to handle 3+ groups (cancellation triples) and
// aggregation of identical positives (e.g. 4 separately-rung kiwis).

import type { ParsedItem } from './schemas';

export type PairMarker =
  | { kind: 'cancelled'; count: number }
  | { kind: 'discount-merged'; count: number }
  | { kind: 'aggregated'; count: number };

export type DetectedItem = ParsedItem & {
  pair_marker?: PairMarker;
};

export type PairDetectionResult = {
  items: DetectedItem[];
};

// Zero-width / BOM-style invisible characters the AI sometimes injects into
// product names. They survive a naive trim() but defeat string equality, so
// strip them before grouping. (Escape forms used so eslint's
// no-irregular-whitespace doesn't flag the literal source.)
const INVISIBLE_CHARS = /\u200B|\u200C|\u200D|\uFEFF/g;

function normalize(name: string | undefined | null): string {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Diagnostic ────────────────────────────────────────────────────────────

export type PairDiagnostic = {
  index: number;
  product_name: string;
  normalized_key: string;
  qty: number;
  unit_price_orig: number;
  group_size: number;
  reason: 'paired-cancelled' | 'paired-discount' | 'aggregated' | 'unpaired';
};

export function explainPairs(parsedItems: ParsedItem[] | null | undefined): PairDiagnostic[] {
  if (!Array.isArray(parsedItems)) return [];
  const groupSizes = new Map<string, number>();
  parsedItems.forEach((it) => {
    const key = normalize(it.product_name);
    if (!key) return;
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  });
  const result = detectPairs(parsedItems);
  // Build a per-key map of detected markers so we can label each input row
  // with the survivor's reason. Multiple surviving rows can share a key (e.g.
  // 3-tuple → 1 cancelled + 1 normal); we report the most-informative kind.
  const markerByKey = new Map<string, PairMarker['kind']>();
  result.items.forEach((it) => {
    const key = normalize(it.product_name);
    if (!it.pair_marker) return;
    if (!markerByKey.has(key)) markerByKey.set(key, it.pair_marker.kind);
  });
  return parsedItems.map((it, index) => {
    const key = normalize(it.product_name);
    const size = groupSizes.get(key) ?? 1;
    const kind = markerByKey.get(key);
    let reason: PairDiagnostic['reason'] = 'unpaired';
    if (kind === 'cancelled') reason = 'paired-cancelled';
    else if (kind === 'discount-merged') reason = 'paired-discount';
    else if (kind === 'aggregated') reason = 'aggregated';
    return {
      index,
      product_name: it.product_name,
      normalized_key: key,
      qty: it.qty,
      unit_price_orig: it.unit_price_orig,
      group_size: size,
      reason,
    };
  });
}

// ── detectPairs ───────────────────────────────────────────────────────────

type Survivor = DetectedItem & { _origIdx: number };

export function detectPairs(parsedItems: ParsedItem[] | null | undefined): PairDetectionResult {
  if (!Array.isArray(parsedItems)) return { items: [] };

  // Group input indices by normalized name. Empty/whitespace names skipped so
  // unrelated unnamed rows don't pair under the empty-string key.
  const groups = new Map<string, number[]>();
  parsedItems.forEach((it, idx) => {
    const key = normalize(it.product_name);
    if (!key) return;
    const arr = groups.get(key);
    if (arr) arr.push(idx);
    else groups.set(key, [idx]);
  });

  // Disposition[idx] = what to do with parsedItems[idx] after pair-passes.
  // 'keep' → emit verbatim. 'skip' → drop (paired/aggregated into another).
  // 'replace-cancelled' → emit zeroed-out with cancelled marker.
  // 'merged-discount' → emit with discount_orig set + discount-merged marker.
  type Disposition =
    | { kind: 'keep' }
    | { kind: 'skip' }
    | { kind: 'replace-cancelled' }
    | { kind: 'merged-discount'; discount_orig: number };
  const disposition: Disposition[] = parsedItems.map(() => ({ kind: 'keep' }));

  // ── Per-group: Pass 1 (exact cancellation) + Pass 2 (discount). ─────────
  groups.forEach((indices) => {
    if (indices.length < 2) return;
    // Split into positives/negatives by sign of qty × unit_price.
    const positives: number[] = [];
    const negatives: number[] = [];
    for (const idx of indices) {
      const it = parsedItems[idx];
      if (!it) continue;
      const total = it.qty * it.unit_price_orig;
      if (total > 0) positives.push(idx);
      else if (total < 0) negatives.push(idx);
    }

    // Pass 1: exact cancellation. Iterate negatives in input order; for each,
    // claim the first unmatched positive whose total magnitude matches.
    const claimed = new Set<number>();
    for (const negIdx of negatives) {
      const neg = parsedItems[negIdx];
      if (!neg) continue;
      const negTotalAbsR = roundCents(Math.abs(neg.qty * neg.unit_price_orig));
      const matchIdx = positives.find((posIdx) => {
        if (claimed.has(posIdx)) return false;
        const pos = parsedItems[posIdx];
        if (!pos) return false;
        if (Math.abs(pos.qty - neg.qty) > 0.001) return false;
        const posTotalR = roundCents(pos.qty * pos.unit_price_orig);
        return posTotalR === negTotalAbsR;
      });
      if (matchIdx !== undefined) {
        claimed.add(matchIdx);
        claimed.add(negIdx);
        disposition[matchIdx] = { kind: 'replace-cancelled' };
        disposition[negIdx] = { kind: 'skip' };
      }
    }

    // Pass 2: discount. Remaining negatives look for a positive with bigger
    // total (same qty). Refund > purchase has no match → leave both.
    for (const negIdx of negatives) {
      if (claimed.has(negIdx)) continue;
      const neg = parsedItems[negIdx];
      if (!neg) continue;
      const negTotalAbsR = roundCents(Math.abs(neg.qty * neg.unit_price_orig));
      const matchIdx = positives.find((posIdx) => {
        if (claimed.has(posIdx)) return false;
        const pos = parsedItems[posIdx];
        if (!pos) return false;
        if (Math.abs(pos.qty - neg.qty) > 0.001) return false;
        const posTotalR = roundCents(pos.qty * pos.unit_price_orig);
        return posTotalR > negTotalAbsR;
      });
      if (matchIdx !== undefined) {
        claimed.add(matchIdx);
        claimed.add(negIdx);
        disposition[matchIdx] = {
          kind: 'merged-discount',
          discount_orig: Math.abs(neg.unit_price_orig),
        };
        disposition[negIdx] = { kind: 'skip' };
      }
    }
  });

  // Build the post-pair survivor list (preserving input order). Each survivor
  // has an _origIdx tag so Pass 3 can pick a stable representative.
  const survivors: Survivor[] = [];
  parsedItems.forEach((it, idx) => {
    const d = disposition[idx];
    if (!d) return;
    if (d.kind === 'keep') {
      survivors.push({ ...it, _origIdx: idx });
    } else if (d.kind === 'replace-cancelled') {
      survivors.push({
        ...it,
        unit_price_orig: 0,
        discount_orig: 0,
        pair_marker: { kind: 'cancelled', count: 1 },
        _origIdx: idx,
      });
    } else if (d.kind === 'merged-discount') {
      survivors.push({
        ...it,
        discount_orig: d.discount_orig,
        pair_marker: { kind: 'discount-merged', count: 1 },
        _origIdx: idx,
      });
    }
    // 'skip' → drop
  });

  // ── Pass 3: orthogonal aggregation. ──────────────────────────────────────
  // Group survivors by composite key. Identical rows merge into one with
  // summed qty and count = group.length. Heterogeneous markers (e.g. one
  // 'cancelled' + one undefined) end up in different keys → not merged.
  //
  // product_code is part of the key — if a store rings two different SKUs
  // under identical name+price (legit dupes or POS oddities), keep them split.
  // BUT: null code is treated as wildcard. If a partial group (name+price+
  // discount+marker_kind) has exactly one concrete code, items with null code
  // there merge with it (typical: AI missed the code on one of N identical
  // lines). If the partial group has two or more different concrete codes,
  // null stays a distinct key — the merge target would be ambiguous.
  type AggKey = string;
  const partialKey = (s: Survivor): string => {
    const name = normalize(s.product_name);
    if (!name) return `__unkeyed_${String(s._origIdx)}`;
    const price = roundCents(s.unit_price_orig);
    const discount = roundCents(s.discount_orig ?? 0);
    const kind = s.pair_marker?.kind ?? 'normal';
    return `${name}|${String(price)}|${String(discount)}|${kind}`;
  };

  // partialKey → set of non-null codes seen on its members.
  const codesByPartial = new Map<string, Set<string>>();
  for (const s of survivors) {
    const code = s.product_code;
    if (code == null || code === '') continue;
    const pk = partialKey(s);
    const set = codesByPartial.get(pk);
    if (set) set.add(code);
    else codesByPartial.set(pk, new Set([code]));
  }

  const aggKey = (s: Survivor): AggKey => {
    const pk = partialKey(s);
    if (pk.startsWith('__unkeyed_')) return pk;
    const code = s.product_code;
    if (code != null && code !== '') return `${pk}|${code}`;
    const codeSet = codesByPartial.get(pk);
    if (codeSet && codeSet.size === 1) {
      const [only] = codeSet;
      return `${pk}|${only ?? ''}`;
    }
    return `${pk}|__nullcode`;
  };

  const aggGroups = new Map<AggKey, Survivor[]>();
  for (const s of survivors) {
    const key = aggKey(s);
    const arr = aggGroups.get(key);
    if (arr) arr.push(s);
    else aggGroups.set(key, [s]);
  }

  // Build a Map: _origIdx → final DetectedItem (or null if dropped by Pass 3).
  // We then output in input order using survivors[*]._origIdx.
  const finalByOrigIdx = new Map<number, DetectedItem | null>();
  aggGroups.forEach((group) => {
    if (group.length < 2) {
      const only = group[0];
      if (only) {
        const { _origIdx, ...rest } = only;
        finalByOrigIdx.set(_origIdx, rest);
      }
      return;
    }
    // Group has 2+ identical rows → aggregate.
    const head = group[0];
    if (!head) return;
    const totalQty = group.reduce((sum, m) => sum + m.qty, 0);
    // If head's code is null but a merged-in row carries a concrete code (the
    // wildcard-null case), promote it onto the survivor.
    const survivorCode =
      head.product_code != null && head.product_code !== ''
        ? head.product_code
        : (group.find((m) => m.product_code != null && m.product_code !== '')?.product_code ??
          head.product_code);
    const existingKind = head.pair_marker?.kind;
    const newMarker: PairMarker =
      existingKind === 'cancelled'
        ? { kind: 'cancelled', count: group.length }
        : existingKind === 'discount-merged'
          ? { kind: 'discount-merged', count: group.length }
          : { kind: 'aggregated', count: group.length };
    const { _origIdx: headOrigIdx, ...headRest } = head;
    finalByOrigIdx.set(headOrigIdx, {
      ...headRest,
      qty: totalQty,
      product_code: survivorCode,
      pair_marker: newMarker,
    });
    // Drop the rest.
    for (let i = 1; i < group.length; i++) {
      const drop = group[i];
      if (drop) finalByOrigIdx.set(drop._origIdx, null);
    }
  });

  // Emit in original input order. (Survivors order matched input; we look
  // them up by _origIdx and skip nulls.)
  const items: DetectedItem[] = [];
  for (const s of survivors) {
    const final = finalByOrigIdx.get(s._origIdx);
    if (final) items.push(final);
  }
  return { items };
}
