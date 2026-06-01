-- Product fuzzy-search RPC + lightweight search log for the new Product Insights page.
--
-- search_products(search): case-insensitive match across name + printed store code,
-- ranked alphabetically. Dynamic SQL so the same WHERE can later be reused for a
-- ranked count without duplicating the predicate.

create or replace function public.search_products(search text)
returns setof public.products
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return query execute
    format(
      'select * from public.products
         where name ilike ''%%%s%%'' or store_product_code ilike ''%%%s%%''
         order by name asc
         limit 50',
      search, search
    );
end;
$$;

grant execute on function public.search_products(text) to authenticated;

comment on function public.search_products(text) is
  'Fuzzy search products by name or store code for the Product Insights page.';

-- Search log: powers "recent searches" + future query analytics. Append-only.
create table public.product_search_log (
  id          text primary key,
  query       text not null,
  searched_at timestamptz not null default now()
);

create index idx_product_search_log_searched_at
  on public.product_search_log (searched_at desc);

alter table public.product_search_log enable row level security;

create policy "allowlist_all_product_search_log" on public.product_search_log
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());
