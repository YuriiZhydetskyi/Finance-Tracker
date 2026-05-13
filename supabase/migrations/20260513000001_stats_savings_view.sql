-- Savings stats: per-month sum of discounts applied to items, in EUR.
-- discount_orig is stored in the receipt's currency, so we join receipts to
-- pick up fx_rate_eur and convert per-line. discounted_items_count tells the
-- user how many lines carried a discount in that month.

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
