-- The photographing queue and the reverse store-label lookup.
--
-- Ranking has to happen server-side: it needs a COUNT over items joined to
-- receipts, which PostgREST cannot express. security invoker + an empty
-- search_path keeps the caller's RLS on items/receipts/products, exactly like
-- stats_by_month in 20260907132451_stats_period_filters.sql.

create function public.search_packaging_candidates(
  p_query       text    default '',
  p_categories  text[]  default null,
  p_stores      text[]  default null,
  p_date_from   date    default null,
  p_date_to     date    default null,
  p_limit       integer default 100,
  p_offset      integer default 0
)
returns table (
  product_id            text,
  product_name          text,
  store                 text,
  store_product_code    text,
  category              text,
  brand                 text,
  is_organic            boolean,
  product_family_id     text,
  product_variant_id    text,
  receipt_labels        text[],
  purchases_count       integer,
  total_qty             numeric,
  total_eur             numeric,
  last_purchased_on     date,
  last_price_orig       numeric,
  last_currency         text,
  group_key             text,
  group_purchases_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with purchases as (
    select i.product_id,
           count(*)::integer                      as purchases_count,
           sum(i.qty)::numeric(14, 3)             as total_qty,
           sum(i.total_eur)::numeric(14, 2)       as total_eur,
           max(r.date)                            as last_purchased_on,
           -- The verbatim printed labels are what make a candidate recognisable
           -- on the shelf; product_name may already have been corrected.
           array_agg(distinct i.raw_product_name) as receipt_labels
      from public.items i
      join public.receipts r on r.id = i.receipt_id
     where i.product_id is not null
       and i.total_orig > 0
       and (p_date_from is null or r.date >= p_date_from)
       and (p_date_to   is null or r.date <= p_date_to)
     group by i.product_id
  ),
  candidates as (
    select p.id, p.name, p.store, p.store_product_code, p.category, p.brand,
           p.is_organic, p.product_family_id, p.product_variant_id,
           coalesce(pu.receipt_labels, array[]::text[]) as receipt_labels,
           coalesce(pu.purchases_count, 0)              as purchases_count,
           coalesce(pu.total_qty, 0)                    as total_qty,
           coalesce(pu.total_eur, 0)                    as total_eur,
           pu.last_purchased_on,
           last_price.price_orig                        as last_price_orig,
           last_price.currency                          as last_currency,
           -- The same product bought at two stores is two rows to link but one
           -- thing to photograph; group_key lets the caller rank and cluster by
           -- the physical product rather than by the store label.
           public.normalize_product_search(concat_ws(' ', p.brand, p.name)) as group_key
      from public.products p
      left join purchases pu on pu.product_id = p.id
      left join lateral (
        select pp.price_orig, pp.currency
          from public.product_prices pp
         where pp.product_id = p.id
         order by pp.date desc, pp.created_at desc
         limit 1
      ) last_price on true
      cross join lateral (
        select public.normalize_product_search(concat_ws(' ',
          p.name, p.brand, p.store, p.store_product_code)) as document
      ) searchable
     where p.packaged_product_id is null
       and p.packaging_not_applicable = false
       and (p_categories is null or p.category = any (p_categories))
       and (p_stores     is null or p.store    = any (p_stores))
       -- strpos, not LIKE: user-typed %, _ and backslashes stay literal, the same
       -- way search_waste_items avoids LIKE metacharacter injection.
       and not exists (
         select 1
           from unnest(string_to_array(public.normalize_product_search(p_query), ' ')) as tokens(token)
          where tokens.token <> ''
            and strpos(searchable.document, tokens.token) = 0
       )
  )
  select c.id, c.name, c.store, c.store_product_code, c.category, c.brand,
         c.is_organic, c.product_family_id, c.product_variant_id,
         c.receipt_labels, c.purchases_count, c.total_qty, c.total_eur,
         c.last_purchased_on, c.last_price_orig, c.last_currency,
         c.group_key,
         sum(c.purchases_count) over (partition by c.group_key)::integer
    from candidates c
   order by sum(c.purchases_count) over (partition by c.group_key) desc,
            c.group_key,
            c.purchases_count desc,
            c.name
   limit  greatest(coalesce(p_limit, 100), 0)
  offset  greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer)
  to authenticated, service_role;

comment on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer) is
  'Store labels with no packaged product yet, most-bought first, clustered by normalized brand+name. Subject to caller RLS.';


-- "This physical product is printed as X at REWE and Y at Aldi", with evidence.

create function public.packaged_product_store_labels(p_packaged_product_id text)
returns table (
  product_id          text,
  store               text,
  product_name        text,
  store_product_code  text,
  receipt_labels      text[],
  purchases_count     integer,
  first_purchased_on  date,
  last_purchased_on   date,
  last_price_orig     numeric,
  last_price_net      numeric,
  last_currency       text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.store, p.name, p.store_product_code,
         coalesce(pu.receipt_labels, array[]::text[]),
         coalesce(pu.purchases_count, 0),
         pu.first_purchased_on,
         pu.last_purchased_on,
         last_price.price_orig,
         last_price.price_net,
         last_price.currency
    from public.products p
    left join lateral (
      select count(*)::integer                      as purchases_count,
             min(r.date)                            as first_purchased_on,
             max(r.date)                            as last_purchased_on,
             array_agg(distinct i.raw_product_name) as receipt_labels
        from public.items i
        join public.receipts r on r.id = i.receipt_id
       where i.product_id = p.id and i.total_orig > 0
    ) pu on true
    left join lateral (
      select pp.price_orig, pp.price_net, pp.currency
        from public.product_prices pp
       where pp.product_id = p.id
       order by pp.date desc, pp.created_at desc
       limit 1
    ) last_price on true
   where p.packaged_product_id = p_packaged_product_id
   order by coalesce(pu.purchases_count, 0) desc, p.store, p.name;
$$;

revoke all on function public.packaged_product_store_labels(text)
  from public, anon, authenticated;
grant execute on function public.packaged_product_store_labels(text)
  to authenticated, service_role;

comment on function public.packaged_product_store_labels(text) is
  'Every store label mapped to one packaged product, with purchase counts and the latest recorded price. Subject to caller RLS.';
