-- Aggregation views for /stats. Read-only; no separate RLS — `security_invoker`
-- makes the view check the calling user against the underlying tables' RLS,
-- so allowlisted users see all data, others see nothing. (Postgres 15+.)
--
-- All amounts in EUR (the canonical currency on the Receipt). Original-currency
-- totals are not aggregated here — would require multi-currency normalisation
-- on display, which is YAGNI for a EUR/UAH-only app where the audit columns
-- already exist on the rows.

create view public.v_stats_by_month
  with (security_invoker = on)
as
select
  to_char(date, 'YYYY-MM')      as month,
  sum(total_eur)::numeric(14,2) as total_eur,
  count(*)::int                 as receipts_count
from public.receipts
group by to_char(date, 'YYYY-MM')
order by to_char(date, 'YYYY-MM') desc;

create view public.v_stats_by_category
  with (security_invoker = on)
as
select
  category,
  sum(total_eur)::numeric(14,2) as total_eur,
  count(*)::int                 as items_count
from public.items
group by category
order by sum(total_eur) desc;

create view public.v_stats_by_user
  with (security_invoker = on)
as
select
  paid_by,
  sum(total_eur)::numeric(14,2) as total_eur,
  count(*)::int                 as receipts_count
from public.receipts
group by paid_by
order by sum(total_eur) desc;

create view public.v_stats_by_store
  with (security_invoker = on)
as
select
  store,
  sum(total_eur)::numeric(14,2) as total_eur,
  count(*)::int                 as receipts_count
from public.receipts
group by store
order by sum(total_eur) desc;
