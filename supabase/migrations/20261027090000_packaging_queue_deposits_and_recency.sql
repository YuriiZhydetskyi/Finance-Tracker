-- The photographing queue: leave deposit/refund rows out, rank by recency.
--
-- 1. Bottle deposits (Pfand / Leergut) and refund-only lines are never a packaged
--    product. They are excluded here, in one view, instead of relying on someone
--    pressing "Без упаковки" on every store's variant of the same deposit line.
-- 2. The queue is ordered by the last purchase (newest first) instead of by how
--    often a product was bought, and can be limited to rows bought since a date.
-- 3. packaging_queue_summary() answers "how many rows" for the same candidate set,
--    so the page can say how many are hidden by the window without a second
--    definition of the queue.

-- A deposit row is recognised by its category or its printed name. Both are
-- needed: the category is only as good as the import's guess (Kaufland prints
-- "Pfandartikel", ALDI "Eigenmarke: Pfand"), the name catches the rest.
create function public.is_deposit_product(p_category text, p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_category = 'Pfand'
      or coalesce(p_name, '') ~* '(pfand|leergut)'
$$;

revoke all on function public.is_deposit_product(text, text) from public, anon, authenticated;
grant execute on function public.is_deposit_product(text, text) to authenticated, service_role;

comment on function public.is_deposit_product(text, text) is
  'True for bottle-deposit rows: category Pfand, or a printed name containing Pfand/Leergut (Einwegpfand, Pfandartikel, Leergut Entl.allg., ...).';


-- Store rows that still need a packaging card. One definition for the queue, its
-- count and the home-page badge.
create view public.v_packaging_queue_products
with (security_invoker = on) as
select p.id, p.name, p.store, p.store_product_code, p.category, p.brand,
       p.is_organic, p.product_family_id, p.product_variant_id
  from public.products p
 where p.packaged_product_id is null
   and p.packaging_not_applicable = false
   and not public.is_deposit_product(p.category, p.name)
   -- A row seen only as a negative line (refund, coupon, Rabatt) was never a
   -- purchase of a physical product. A row with no items at all stays: it has
   -- simply not been bought yet.
   and not (
     exists (select 1 from public.items i where i.product_id = p.id and i.total_orig < 0)
     and not exists (select 1 from public.items i where i.product_id = p.id and i.total_orig > 0)
   );

revoke all on public.v_packaging_queue_products from public, anon, authenticated;
grant select on public.v_packaging_queue_products to authenticated, service_role;

comment on view public.v_packaging_queue_products is
  'Store rows that need a packaging card: not linked, not opted out, not a bottle deposit and not a refund-only line. Subject to caller RLS.';


-- The signature changes (new p_last_purchased_since), and PostgREST cannot pick
-- between two overloads that accept the same named arguments, so replace it.
drop function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer);

create function public.search_packaging_candidates(
  p_query                text    default '',
  p_categories           text[]  default null,
  p_stores               text[]  default null,
  p_date_from            date    default null,
  p_date_to              date    default null,
  p_limit                integer default 100,
  p_offset               integer default 0,
  p_last_purchased_since date    default null
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
      from public.v_packaging_queue_products p
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
     where (p_categories is null or p.category = any (p_categories))
       and (p_stores     is null or p.store    = any (p_stores))
       -- strpos, not LIKE: user-typed %, _ and backslashes stay literal, the same
       -- way search_waste_items avoids LIKE metacharacter injection.
       and not exists (
         select 1
           from unnest(string_to_array(public.normalize_product_search(p_query), ' ')) as tokens(token)
          where tokens.token <> ''
            and strpos(searchable.document, tokens.token) = 0
       )
  ),
  -- Group figures are taken before the recency window is applied: a row that is
  -- inside the window still knows the same product was bought at another store,
  -- even when that other row is older and hidden.
  grouped as (
    select c.*,
           sum(c.purchases_count) over (partition by c.group_key)::integer as group_purchases_count,
           max(c.last_purchased_on) over (partition by c.group_key)       as group_last_purchased_on
      from candidates c
  )
  select g.id, g.name, g.store, g.store_product_code, g.category, g.brand,
         g.is_organic, g.product_family_id, g.product_variant_id,
         g.receipt_labels, g.purchases_count, g.total_qty, g.total_eur,
         g.last_purchased_on, g.last_price_orig, g.last_currency,
         g.group_key, g.group_purchases_count
    from grouped g
   where p_last_purchased_since is null
      or g.last_purchased_on >= p_last_purchased_since
   -- Newest first. Rows of one physical product stay together (they are ranked by
   -- the group's newest purchase), and never-bought rows sink to the bottom.
   order by g.group_last_purchased_on desc nulls last,
            g.group_key,
            g.last_purchased_on desc nulls last,
            g.purchases_count desc,
            g.name,
            g.store,
            g.id
   limit  greatest(coalesce(p_limit, 100), 0)
  offset  greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date)
  to authenticated, service_role;

comment on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date) is
  'Store labels with no packaged product yet, most recently bought first, clustered by normalized brand+name. p_last_purchased_since keeps only rows bought on or after that date. Deposit and refund-only rows are excluded. Subject to caller RLS.';


-- Size of the same candidate set the list returns, split by the recency window.
create function public.packaging_queue_summary(
  p_query                text default '',
  p_last_purchased_since date default null
)
returns table (
  total_count  integer,
  recent_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer,
         (count(*) filter (
            where p_last_purchased_since is null
               or q.last_purchased_on >= p_last_purchased_since
         ))::integer
    from public.search_packaging_candidates(p_query, null, null, null, null, 2147483647, 0, null) q;
$$;

revoke all on function public.packaging_queue_summary(text, date) from public, anon, authenticated;
grant execute on function public.packaging_queue_summary(text, date) to authenticated, service_role;

comment on function public.packaging_queue_summary(text, date) is
  'total_count: all queue rows matching the query. recent_count: those last bought on or after p_last_purchased_since (all of them when it is null). Subject to caller RLS.';
