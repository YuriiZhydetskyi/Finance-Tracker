import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PackagingCandidateRow } from '../types';
import { PackagingCandidatesList } from './PackagingCandidatesList';

const HINT = /купувався і в інших магазинах/;

function candidate(overrides: Partial<PackagingCandidateRow> = {}): PackagingCandidateRow {
  return {
    product_id: 'p1',
    product_name: 'Vollkorn-Sandwich',
    store: 'ALDI SÜD',
    store_product_code: '333333',
    category: 'Бакалія',
    brand: null,
    is_organic: null,
    product_family_id: null,
    product_variant_id: null,
    receipt_labels: ['Vollkorn-Sandwich'],
    purchases_count: 2,
    total_qty: 2,
    total_eur: 4.98,
    last_purchased_on: '2026-10-20',
    last_price_orig: 2.49,
    last_currency: 'EUR',
    group_key: 'vollkorn sandwich',
    group_purchases_count: 2,
    other_store_purchases_count: 0,
    ...overrides,
  };
}

function renderList(candidates: PackagingCandidateRow[]) {
  return render(
    <PackagingCandidatesList
      candidates={candidates}
      onCreateCard={vi.fn()}
      onLinkExisting={vi.fn()}
      onSkip={vi.fn()}
    />,
  );
}

describe('PackagingCandidatesList «other stores» hint', () => {
  it('does not fire for the same chain under another spelling or another code', () => {
    // Both rows are ALDI SÜD (one still stored as "Aldi Süd"): the cluster has three
    // purchases, more than either row, but none of them is in a different store.
    renderList([
      candidate({
        product_id: 'p1',
        group_purchases_count: 3,
        other_store_purchases_count: 0,
      }),
      candidate({
        product_id: 'p2',
        store: 'Aldi Süd',
        purchases_count: 1,
        group_purchases_count: 3,
        other_store_purchases_count: 0,
      }),
    ]);

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('fires once, on the first row of a cluster bought in a different store', () => {
    renderList([
      candidate({
        product_id: 'p1',
        store: 'EDEKA Musterstadt',
        purchases_count: 1,
        group_key: 'gut beispiel eier',
        group_purchases_count: 2,
        other_store_purchases_count: 1,
      }),
      candidate({
        product_id: 'p2',
        store: 'Marktkauf Musterstadt',
        purchases_count: 1,
        group_key: 'gut beispiel eier',
        group_purchases_count: 2,
        other_store_purchases_count: 1,
      }),
    ]);

    expect(screen.getAllByText(HINT)).toHaveLength(1);
  });

  it('stays quiet for a row nobody else shares', () => {
    renderList([candidate()]);

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});
