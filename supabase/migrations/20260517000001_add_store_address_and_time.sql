-- Add freeform store address (e.g. "Hauptstr. 12, 80331 München") and
-- time-of-day of purchase (HH:MM:SS) to receipts. Both nullable: not every
-- receipt prints them, and manual entries can leave them empty.
--
-- Stored as separate `time` column rather than collapsing date+time into a
-- single timestamptz — that would force changes across v_stats_* views, FX
-- walk-back, and every queries that reads `date`.
--
-- Append-only at end of table per schema discipline (no reorder/rename).

alter table public.receipts add column store_address text;
alter table public.receipts add column time time;
