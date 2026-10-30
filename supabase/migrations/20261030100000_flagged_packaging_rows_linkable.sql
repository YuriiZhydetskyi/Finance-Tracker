-- Rows flagged «Без упаковки» stay linkable from the card import (ADR-0034, amended).
--
-- Loose produce is sold by weight: the receipt multiplies by a non-round quantity,
-- and the 'weighed' rule already keeps those rows out of the photographing queue.
-- A shelf-tag photo of such produce is welcome when the owner took one (its fuller
-- name beats the truncated receipt label) but never required. Until now a flagged
-- row vanished from the import review, so a tag card could not be linked to it.
--
--   1. A flagged row must still be findable when a card is imported. The queue
--      view is split: v_packaging_link_targets keeps every unlinked, non-deposit
--      row and exposes the flag; v_packaging_queue_products is that view without
--      the flagged rows, so the queue, its count and the badge are unchanged.
--      search_packaging_candidates gets p_include_not_applicable (default false)
--      for the import review.
--   2. Linking a card clears the flag and its reason: a card wins over "no
--      packaging", as in merge_products (ADR-0033).
--   3. The till's produce bag ("OuG Beutel") is a 'bag'. The rule is applied once
--      to the existing rows, reversible from the «Без упаковки» tab.
--
-- Deliberately NOT done: whole-quantity produce is not flagged as "loose". A bag
-- or a net rung up as 1 x price is packed, and an integer quantity says nothing
-- else, so those rows stay in the queue.

-- ── 1. The decision ─────────────────────────────────────────────────────────
create or replace function public.packaging_exclusion_reason(
  p_category         text,
  p_name             text,
  p_positive_lines   integer,
  p_fractional_lines integer
)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select case
    -- Nothing physical to photograph: rent, bills, fuel, fares, cafés, tickets,
    -- courses, subscriptions, services.
    when p_category in ('Оренда житла', 'Комуналка', 'Авто', 'Транспорт', 'Кафе/ресторани',
                        'Розваги', 'Курси/освіта', 'Підписки', 'Послуги') then 'service'
    -- No nutrition label and no card the catalogue wants.
    when p_category in ('Одяг', 'Електроніка') then 'non_food'
    -- Carrier and produce bags the shop sells at the till.
    when coalesce(p_name, '') ~* '(trage|einkaufs|papier|gewebe|plastik)(tasche|t[üu]te|beutel)|knotenbeutel|\youg[ -]?beutel'
      then 'bag'
    -- Sold by weight: at least half of the purchases have a fractional quantity
    -- (0.67 kg), so there is no pack and no barcode. Meat and fish are the
    -- exception: weighed, pre-packed meat and fish still get a card (barcode
    -- null, identity by name), as decided when the packaging PDFs were imported.
    when coalesce(p_positive_lines, 0) > 0 and p_fractional_lines * 2 >= p_positive_lines
         and p_category not like 'М%ясо/риба' then 'weighed'
  end;
$$;

comment on column public.products.packaging_not_applicable_reason is
  'Set only by apply_packaging_exclusion_rule(): the rule that flagged the row (service, non_food, bag, weighed). NULL = flagged by hand or not flagged. Cleared whenever the flag is cleared or a card is linked.';


-- ── 2. Flagged rows stay findable for the import review ─────────────────────
create view public.v_packaging_link_targets
with (security_invoker = on) as
select p.id, p.name, p.store, p.store_product_code, p.category, p.brand,
       p.is_organic, p.product_family_id, p.product_variant_id,
       p.packaging_not_applicable
  from public.products p
 where p.packaged_product_id is null
   and not public.is_deposit_product(p.category, p.name)
   -- A row seen only as a negative line (refund, coupon, Rabatt) was never a
   -- purchase of a physical product. A row with no items at all stays: it has
   -- simply not been bought yet.
   and not (
     exists (select 1 from public.items i where i.product_id = p.id and i.total_orig < 0)
     and not exists (select 1 from public.items i where i.product_id = p.id and i.total_orig > 0)
   );

revoke all on public.v_packaging_link_targets from public, anon, authenticated;
grant select on public.v_packaging_link_targets to authenticated, service_role;

comment on view public.v_packaging_link_targets is
  'Store rows a packaging card can still be linked to: not linked, not a bottle deposit and not a refund-only line, flagged «Без упаковки» or not. Subject to caller RLS.';

-- Same columns as before (CREATE OR REPLACE VIEW cannot change them); grants stay.
create or replace view public.v_packaging_queue_products
with (security_invoker = on) as
select t.id, t.name, t.store, t.store_product_code, t.category, t.brand,
       t.is_organic, t.product_family_id, t.product_variant_id
  from public.v_packaging_link_targets t
 where not t.packaging_not_applicable;

comment on view public.v_packaging_queue_products is
  'Store rows that need a packaging card: not linked, not opted out, not a bottle deposit and not a refund-only line. v_packaging_link_targets without the «Без упаковки» rows. Subject to caller RLS.';

-- A new parameter changes the signature, and PostgREST cannot pick between two
-- overloads that accept the same named arguments, so replace it. The body is
-- search_packaging_candidates from 20261027120600; only the source view and the
-- flag filter differ, and with the default the result is identical.
drop function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date);

create function public.search_packaging_candidates(
  p_query                  text    default '',
  p_categories             text[]  default null,
  p_stores                 text[]  default null,
  p_date_from              date    default null,
  p_date_to                date    default null,
  p_limit                  integer default 100,
  p_offset                 integer default 0,
  p_last_purchased_since   date    default null,
  p_include_not_applicable boolean default false
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
      from public.v_packaging_link_targets p
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
     where (coalesce(p_include_not_applicable, false) or not p.packaging_not_applicable)
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

revoke all on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date, boolean)
  from public, anon, authenticated;
grant execute on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date, boolean)
  to authenticated, service_role;

comment on function public.search_packaging_candidates(text, text[], text[], date, date, integer, integer, date, boolean) is
  'Store labels with no packaged product yet, most recently bought first, clustered by normalized brand+name. group_purchases_count counts the whole cluster; other_store_purchases_count only the rows of other canonical stores. p_last_purchased_since keeps only rows bought on or after that date. p_include_not_applicable also lists rows flagged «Без упаковки» (for linking an imported card; the queue leaves them out). Deposit and refund-only rows are excluded. Subject to caller RLS.';


-- ── 3. A card wins over «Без упаковки» ──────────────────────────────────────
-- The reason is cleared here too: clear_packaging_na_reason only fires when the
-- flag itself is in the SET list, and the CHECK forbids a reason without a flag.
create function public.clear_packaging_na_on_card_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.packaged_product_id is not null then
    new.packaging_not_applicable := false;
    new.packaging_not_applicable_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_packaging_na_on_card_link() from public, anon, authenticated;

create trigger trg_products_card_clears_packaging_na
  before insert or update of packaged_product_id on public.products
  for each row execute function public.clear_packaging_na_on_card_link();


-- ── Apply it once ───────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_total integer := 0;
  v_summary text := '';
begin
  for r in select * from public.apply_packaging_exclusion_rule(false) loop
    v_total := v_total + 1;
    raise notice 'FLAGGED [%] "%" (%, %, % purchase line(s))',
      r.reason, r.product_name, r.store, r.category, r.purchases_count;
  end loop;

  select coalesce(string_agg(format('%s %s', x.n, x.reason), ', ' order by x.reason), 'none')
    into v_summary
    from (select p.packaging_not_applicable_reason as reason, count(*) as n
            from public.products p
           where p.packaging_not_applicable_reason is not null
           group by 1) x;

  if exists (select 1 from public.apply_packaging_exclusion_rule(true)) then
    raise exception 'apply_packaging_exclusion_rule is not idempotent';
  end if;

  raise notice 'packaging exclusion: % row(s) newly flagged; all reasons now: %', v_total, v_summary;
end;
$$;
