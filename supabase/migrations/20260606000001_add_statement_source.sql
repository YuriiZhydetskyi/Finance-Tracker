-- Add 'statement' to receipt_source: stub receipts created from an orphan card
-- transaction (a spend that has no photographed/entered receipt — e.g. forgot to
-- snap the McDonald's bill). Such a receipt records amount/store/date but its
-- single line item carries no real product detail. See docs/data-model.md.
--
-- Separate migration: `alter type ... add value` cannot run in the same
-- transaction that USES the new value. Nothing here uses it (the column already
-- exists, the value is just added to the enum), so this is safe on its own.

alter type public.receipt_source add value if not exists 'statement';
