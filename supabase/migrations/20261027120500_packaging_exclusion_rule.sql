-- «Без упаковки» in bulk (ADR-0034).
--
-- Weighed goods and rows that can never have a packaging card (services, fuel,
-- clothes, electronics, carrier bags) sit in the photographing queue until
-- somebody presses «Без упаковки» on every one of them. This is the same flag,
-- set by a rule instead of by hand, with the rule recorded in
-- products.packaging_not_applicable_reason so the batch can be undone.
--
-- Deliberately NOT flagged:
--   * whole-quantity loose produce (apples, carrots, grapes, tomatoes sold by the
--     piece or in a tray): whether it gets a shelf-tag card is an open decision;
--   * deposit and refund rows: v_packaging_queue_products (ADR-0031) already
--     keeps them out of the queue, one definition for all of it;
--   * weighed meat and fish: pre-packed, they still get a card without a barcode;
--   * household and pharmacy goods: those do have a package to photograph.

-- The decision on its own, so it can be tested without a table.
create function public.packaging_exclusion_reason(
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
    when coalesce(p_name, '') ~* '(trage|einkaufs|papier|gewebe|plastik)(tasche|t[üu]te|beutel)|knotenbeutel'
      then 'bag'
    -- Sold by weight: at least half of the purchases have a fractional quantity
    -- (0.67 kg), so there is no pack and no barcode. Meat and fish are the
    -- exception: weighed, pre-packed meat and fish still get a card (barcode
    -- null, identity by name), as decided when the packaging PDFs were imported.
    when coalesce(p_positive_lines, 0) > 0 and p_fractional_lines * 2 >= p_positive_lines
         and p_category not like 'М%ясо/риба' then 'weighed'
  end;
$$;

revoke all on function public.packaging_exclusion_reason(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.packaging_exclusion_reason(text, text, integer, integer)
  to authenticated, service_role;

comment on function public.packaging_exclusion_reason(text, text, integer, integer) is
  'Why a store row can never get a packaging card: service, non_food, bag or weighed; NULL when it can. Pure; apply_packaging_exclusion_rule() feeds it.';

-- The batch. p_dry_run (default true) returns what would be flagged and writes
-- nothing; false flags exactly those rows. Only rows with no card, not already
-- flagged and not a deposit row are considered, so a second run flags nothing.
create function public.apply_packaging_exclusion_rule(p_dry_run boolean default true)
returns table (
  product_id      text,
  product_name    text,
  store           text,
  category        text,
  reason          text,
  purchases_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  p_dry_run := coalesce(p_dry_run, true);
  return query
  with lines as (
    select i.product_id as line_product_id,
           count(*) filter (where i.total_orig > 0)::integer as positive_lines,
           count(*) filter (where i.total_orig > 0 and i.qty <> trunc(i.qty))::integer as fractional_lines
      from public.items i
     where i.product_id is not null
     group by i.product_id
  ),
  candidates as (
    select p.id as candidate_id, p.name as candidate_name, p.store as candidate_store,
           p.category as candidate_category,
           public.packaging_exclusion_reason(
             p.category, p.name, coalesce(l.positive_lines, 0), coalesce(l.fractional_lines, 0)
           ) as candidate_reason,
           coalesce(l.positive_lines, 0) as candidate_lines
      from public.products p
      left join lines l on l.line_product_id = p.id
     where p.packaged_product_id is null
       and not p.packaging_not_applicable
       and not public.is_deposit_product(p.category, p.name)
  ),
  chosen as (
    select * from candidates c where c.candidate_reason is not null
  ),
  flagged as (
    update public.products p
       set packaging_not_applicable = true,
           packaging_not_applicable_reason = c.candidate_reason
      from chosen c
     where not p_dry_run and p.id = c.candidate_id
    returning p.id
  )
  select c.candidate_id, c.candidate_name, c.candidate_store, c.candidate_category,
         c.candidate_reason, c.candidate_lines
    from chosen c
   order by c.candidate_reason, c.candidate_store, c.candidate_name, c.candidate_id;
end;
$$;

revoke execute on function public.apply_packaging_exclusion_rule(boolean) from public, anon;
grant execute on function public.apply_packaging_exclusion_rule(boolean) to authenticated, service_role;

comment on function public.apply_packaging_exclusion_rule(boolean) is
  'Marks rows that can never get a packaging card (services, non-food, bags, weighed goods) as packaging_not_applicable, recording the rule in packaging_not_applicable_reason. p_dry_run (default true) only lists them. Undo per row or per reason from the «Без упаковки» tab.';

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

  raise notice 'packaging exclusion: % row(s) flagged (%); a second run flags none', v_total, v_summary;
end;
$$;
