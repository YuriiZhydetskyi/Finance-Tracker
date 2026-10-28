-- The «Цей товар купувався і в інших магазинах» hint (ADR-0034).
--
-- The hint used to fire whenever group_purchases_count > purchases_count, i.e.
-- whenever ANY other row in the same brand+name cluster had been bought. That
-- includes the same shop under another spelling, another code of the same
-- article and a code-less twin. The queue now says how many purchases the
-- cluster has in genuinely different stores (compared by canonical store name),
-- and the hint fires on that number only.
--
-- The body is search_packaging_candidates from 20261027090000 (Pfand excluded,
-- newest first, recency window) with one added column; nothing else changed.

-- The return type changes, and CREATE OR REPLACE cannot do that.
drop function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date);

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
  product_id                  text,
  product_name                text,
  store                       text,
  store_product_code          text,
  category                    text,
  brand                       text,
  is_organic                  boolean,
  product_family_id           text,
  product_variant_id          text,
  receipt_labels              text[],
  purchases_count             integer,
  total_qty                   numeric,
  total_eur                   numeric,
  last_purchased_on           date,
  last_price_orig             numeric,
  last_currency               text,
  group_key                   text,
  group_purchases_count       integer,
  other_store_purchases_count integer
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
           public.normalize_product_search(concat_ws(' ', p.brand, p.name)) as group_key,
           -- Stores are told apart by canonical name, so "Aldi Süd" and "ALDI SÜD"
           -- (a pair still waiting for the owner's decision) are one store here.
           public.canonical_store_name(p.store)         as canonical_store
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
           max(c.last_purchased_on) over (partition by c.group_key)       as group_last_purchased_on,
           (sum(c.purchases_count) over (partition by c.group_key)
              - sum(c.purchases_count) over (partition by c.group_key, c.canonical_store))::integer
                                                                           as other_store_purchases_count
      from candidates c
  )
  select g.id, g.name, g.store, g.store_product_code, g.category, g.brand,
         g.is_organic, g.product_family_id, g.product_variant_id,
         g.receipt_labels, g.purchases_count, g.total_qty, g.total_eur,
         g.last_purchased_on, g.last_price_orig, g.last_currency,
         g.group_key, g.group_purchases_count, g.other_store_purchases_count
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
  'Store labels with no packaged product yet, most recently bought first, clustered by normalized brand+name. group_purchases_count counts the whole cluster; other_store_purchases_count only the rows of other canonical stores. p_last_purchased_since keeps only rows bought on or after that date. Deposit and refund-only rows are excluded. Subject to caller RLS.';
