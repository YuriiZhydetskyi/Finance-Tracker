-- Per-unit prices and discounts need a third decimal: fuel is sold at 2.109 EUR/l
-- and multi-buy deals split into prices such as 1.245. Line totals stay at two
-- decimals: total_orig = round(qty * (unit_price_orig - discount_orig), 2).
--
-- The savings view reads items.discount_orig, so it must be dropped before the
-- column type can change and recreated unchanged afterwards.

drop view public.v_stats_savings_by_month;

alter table public.items
  alter column unit_price_orig type numeric(12, 3),
  alter column discount_orig type numeric(12, 3);

create view public.v_stats_savings_by_month
  with (security_invoker = on)
as
select
  to_char(r.date, 'YYYY-MM')                                            as month,
  sum(i.discount_orig * i.qty * r.fx_rate_eur)::numeric(14,2)            as savings_eur,
  count(*) filter (where i.discount_orig > 0)::int                       as discounted_items_count
from public.items i
join public.receipts r on r.id = i.receipt_id
where i.discount_orig > 0
group by to_char(r.date, 'YYYY-MM')
order by to_char(r.date, 'YYYY-MM') desc;
