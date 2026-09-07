-- Period-aware statistics. The old views aggregate away receipt dates, so a
-- date condition applied by PostgREST would be too late. These invoker
-- functions keep aggregation in Postgres while preserving the RLS context of
-- the caller on receipts and items.

create function public.stats_by_month(
  p_date_from date default null,
  p_date_to date default null,
  p_categories text[] default null,
  p_stores text[] default null
)
returns table(month text, total_eur numeric, receipts_count integer)
language sql stable security invoker set search_path = ''
as $$
  select
    to_char(r.date, 'YYYY-MM'),
    sum(i.total_eur)::numeric(14,2),
    count(distinct r.id)::integer
  from public.items i
  join public.receipts r on r.id = i.receipt_id
  where (p_date_from is null or r.date >= p_date_from)
    and (p_date_to is null or r.date <= p_date_to)
    and (p_categories is null or i.category = any(p_categories))
    and (p_stores is null or r.store = any(p_stores))
  group by to_char(r.date, 'YYYY-MM')
  order by to_char(r.date, 'YYYY-MM') desc;
$$;

create function public.stats_by_category(
  p_date_from date default null,
  p_date_to date default null,
  p_categories text[] default null,
  p_stores text[] default null
)
returns table(category text, total_eur numeric, items_count integer)
language sql stable security invoker set search_path = ''
as $$
  select i.category, sum(i.total_eur)::numeric(14,2), count(*)::integer
  from public.items i
  join public.receipts r on r.id = i.receipt_id
  where (p_date_from is null or r.date >= p_date_from)
    and (p_date_to is null or r.date <= p_date_to)
    and (p_categories is null or i.category = any(p_categories))
    and (p_stores is null or r.store = any(p_stores))
  group by i.category
  order by sum(i.total_eur) desc;
$$;

create function public.stats_by_user(
  p_date_from date default null,
  p_date_to date default null,
  p_categories text[] default null,
  p_stores text[] default null
)
returns table(paid_by text, total_eur numeric, receipts_count integer)
language sql stable security invoker set search_path = ''
as $$
  select r.paid_by, sum(i.total_eur)::numeric(14,2), count(distinct r.id)::integer
  from public.items i
  join public.receipts r on r.id = i.receipt_id
  where (p_date_from is null or r.date >= p_date_from)
    and (p_date_to is null or r.date <= p_date_to)
    and (p_categories is null or i.category = any(p_categories))
    and (p_stores is null or r.store = any(p_stores))
  group by r.paid_by
  order by sum(i.total_eur) desc;
$$;

create function public.stats_by_store(
  p_date_from date default null,
  p_date_to date default null,
  p_categories text[] default null,
  p_stores text[] default null,
  p_limit integer default 10
)
returns table(store text, total_eur numeric, receipts_count integer)
language sql stable security invoker set search_path = ''
as $$
  select r.store, sum(i.total_eur)::numeric(14,2), count(distinct r.id)::integer
  from public.items i
  join public.receipts r on r.id = i.receipt_id
  where (p_date_from is null or r.date >= p_date_from)
    and (p_date_to is null or r.date <= p_date_to)
    and (p_categories is null or i.category = any(p_categories))
    and (p_stores is null or r.store = any(p_stores))
  group by r.store
  order by sum(i.total_eur) desc
  limit greatest(p_limit, 1);
$$;

create function public.stats_savings_by_month(
  p_date_from date default null,
  p_date_to date default null,
  p_categories text[] default null,
  p_stores text[] default null
)
returns table(month text, savings_eur numeric, discounted_items_count integer)
language sql stable security invoker set search_path = ''
as $$
  select
    to_char(r.date, 'YYYY-MM'),
    sum(i.discount_orig * i.qty * r.fx_rate_eur)::numeric(14,2),
    count(*)::integer
  from public.items i
  join public.receipts r on r.id = i.receipt_id
  where i.discount_orig > 0
    and (p_date_from is null or r.date >= p_date_from)
    and (p_date_to is null or r.date <= p_date_to)
    and (p_categories is null or i.category = any(p_categories))
    and (p_stores is null or r.store = any(p_stores))
  group by to_char(r.date, 'YYYY-MM')
  order by to_char(r.date, 'YYYY-MM') desc;
$$;

create function public.stats_waste_by_month(
  p_date_from date default null,
  p_date_to date default null,
  p_categories text[] default null,
  p_stores text[] default null
)
returns table(month text, wasted_value_eur numeric, wasted_items_count integer)
language sql stable security invoker set search_path = ''
as $$
  select
    to_char(r.date, 'YYYY-MM'),
    sum((i.wasted_qty / nullif(i.qty, 0)) * i.total_eur)::numeric(14,2),
    count(*)::integer
  from public.items i
  join public.receipts r on r.id = i.receipt_id
  where i.wasted_qty > 0
    and (p_date_from is null or r.date >= p_date_from)
    and (p_date_to is null or r.date <= p_date_to)
    and (p_categories is null or i.category = any(p_categories))
    and (p_stores is null or r.store = any(p_stores))
  group by to_char(r.date, 'YYYY-MM')
  order by to_char(r.date, 'YYYY-MM') desc;
$$;

-- The filter lists deliberately span all accessible data, not just the
-- current period, so a saved choice stays visible when its period is empty.
create function public.stats_filter_options()
returns table(categories text[], stores text[])
language sql stable security invoker set search_path = ''
as $$
  select
    coalesce(
      (select array_agg(category order by category)
       from (select distinct category from public.items) as category_values),
      '{}'::text[]
    ),
    coalesce(
      (select array_agg(store order by store)
       from (select distinct store from public.receipts) as store_values),
      '{}'::text[]
    );
$$;

revoke execute on function public.stats_by_month(date, date, text[], text[]) from public, anon;
revoke execute on function public.stats_by_category(date, date, text[], text[]) from public, anon;
revoke execute on function public.stats_by_user(date, date, text[], text[]) from public, anon;
revoke execute on function public.stats_by_store(date, date, text[], text[], integer) from public, anon;
revoke execute on function public.stats_savings_by_month(date, date, text[], text[]) from public, anon;
revoke execute on function public.stats_waste_by_month(date, date, text[], text[]) from public, anon;
revoke execute on function public.stats_filter_options() from public, anon;

grant execute on function public.stats_by_month(date, date, text[], text[]) to authenticated;
grant execute on function public.stats_by_category(date, date, text[], text[]) to authenticated;
grant execute on function public.stats_by_user(date, date, text[], text[]) to authenticated;
grant execute on function public.stats_by_store(date, date, text[], text[], integer) to authenticated;
grant execute on function public.stats_savings_by_month(date, date, text[], text[]) to authenticated;
grant execute on function public.stats_waste_by_month(date, date, text[], text[]) to authenticated;
grant execute on function public.stats_filter_options() to authenticated;
