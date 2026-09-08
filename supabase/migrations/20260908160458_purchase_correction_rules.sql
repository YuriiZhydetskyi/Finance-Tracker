-- Store-specific corrections retain receipt evidence separately from the
-- user-facing purchase snapshot. A printed label such as "Original" is only
-- meaningful in the context of the shop that printed it.

alter table public.items
  add column raw_product_name text;

update public.items
set raw_product_name = product_name
where raw_product_name is null;

alter table public.items
  alter column raw_product_name set not null,
  add constraint items_raw_product_name_not_blank
    check (btrim(raw_product_name) <> '');


comment on column public.items.raw_product_name is
  'Verbatim product label first recorded from the receipt. Classification corrections never overwrite it.';

create function public.normalize_product_match_key(p_value text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g'));
$$;
revoke all on function public.normalize_product_match_key(text) from public, anon, authenticated;
grant execute on function public.normalize_product_match_key(text) to authenticated, service_role;

comment on function public.normalize_product_match_key(text) is
  'Exact receipt-rule key: lower case and whitespace normalization only; punctuation remains meaningful.';

create table public.product_match_rules (
  store_key text not null check (btrim(store_key) <> ''),
  raw_product_name_key text not null check (btrim(raw_product_name_key) <> ''),
  product_id text not null references public.products(id) on delete cascade,
  product_name text not null check (btrim(product_name) <> ''),
  category text not null references public.categories(name) on update cascade,
  product_family_id text references public.product_families(id),
  product_variant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_key, raw_product_name_key),
  constraint product_match_rules_variant_requires_family
    check (product_variant_id is null or product_family_id is not null),
  constraint product_match_rules_variant_family_fkey
    foreign key (product_variant_id, product_family_id)
    references public.product_variants(id, family_id)
);

comment on table public.product_match_rules is
  'Exact normalized receipt-label rules, scoped to one normalized store name. They never match a different store.';

create index idx_product_match_rules_product_id
  on public.product_match_rules (product_id);

alter table public.product_match_rules enable row level security;
revoke all on public.product_match_rules from public, anon, authenticated;
grant select, insert, update, delete on public.product_match_rules to authenticated;
grant all on public.product_match_rules to service_role;

create policy allowlist_all_product_match_rules on public.product_match_rules
  for all to authenticated
  using ((select public.is_allowed_user()))
  with check ((select public.is_allowed_user()));

create trigger trg_product_match_rules_updated_at
  before update on public.product_match_rules
  for each row execute function public.set_updated_at();

create function public.apply_product_match_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_store_key text;
  v_receipt_source public.receipt_source;
  v_product public.products%rowtype;
  v_rule public.product_match_rules%rowtype;
begin
  -- This is intentionally set before matching, so the original printed label
  -- survives even when a rule replaces the visible snapshot on insert.
  new.raw_product_name := coalesce(new.raw_product_name, new.product_name);

  select public.normalize_product_match_key(r.store), r.source
    into v_store_key, v_receipt_source
    from public.receipts r
   where r.id = new.receipt_id;

  -- Full receipt editing deliberately supplies an explicit classification for
  -- every replacement row. Never overwrite that human decision with a rule.
  if v_receipt_source = 'edit' then
    return new;
  end if;

  select p.*
    into v_product
    from public.product_match_rules rule
    join public.products p on p.id = rule.product_id
   where rule.store_key = v_store_key
     and rule.raw_product_name_key = public.normalize_product_match_key(new.raw_product_name);

  if found then
    select rule.* into v_rule
      from public.product_match_rules rule
     where rule.store_key = v_store_key
       and rule.raw_product_name_key = public.normalize_product_match_key(new.raw_product_name);
    new.product_id := v_product.id;
    new.product_name := v_rule.product_name;
    new.category := v_rule.category;
    new.product_family_id := v_rule.product_family_id;
    new.product_variant_id := v_rule.product_variant_id;
  end if;

  return new;
end;
$$;
revoke all on function public.apply_product_match_rule() from public, anon, authenticated;

-- This must run after taxonomy inheritance. A rule owns an explicit historical
-- snapshot, including intentional NULL family/variant values.
create trigger trg_items_z_apply_product_match_rule
  before insert on public.items
  for each row execute function public.apply_product_match_rule();

create function public.reject_raw_product_name_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.raw_product_name is distinct from old.raw_product_name then
    raise invalid_parameter_value using message = 'The original receipt product label cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_raw_product_name_change() from public, anon, authenticated;

create trigger trg_items_reject_raw_product_name_change
  before update of raw_product_name on public.items
  for each row execute function public.reject_raw_product_name_change();

create function public.correct_purchase_classification(
  p_item_id text,
  p_product_id text,
  p_product_name text,
  p_category text,
  p_product_family_id text default null,
  p_product_variant_id text default null,
  p_remember_rule boolean default false
)
returns public.items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_store text;
  v_target_product_id text;
begin
  if p_product_id is null or btrim(p_product_id) = '' then
    raise invalid_parameter_value using message = 'A canonical product id is required.';
  end if;
  if p_product_name is null or btrim(p_product_name) = '' then
    raise invalid_parameter_value using message = 'A product name is required.';
  end if;

  select i.* into v_item
    from public.items i
   where i.id = p_item_id
   for update;
  if not found then
    raise exception 'Purchase item was not found.' using errcode = 'P0002';
  end if;

  select r.store into v_store
    from public.receipts r
   where r.id = v_item.receipt_id;

  -- Reuse the store-local product identity by its actual uniqueness key. The
  -- correction snapshot stays on Item/rule and never mutates this shared
  -- catalogue row merely because its category or taxonomy differs.
  select p.id into v_target_product_id
    from public.products p
   where p.store = v_store
     and p.name = btrim(p_product_name)
     and p.store_product_code is null
   order by p.created_at
   limit 1;

  if not found then
    insert into public.products (
      id, name, store, store_product_code, category, product_family_id, product_variant_id
    ) values (
      p_product_id, btrim(p_product_name), v_store, null, p_category,
      p_product_family_id, p_product_variant_id
    );
    v_target_product_id := p_product_id;
  end if;

  -- Link first so the existing inheritance trigger can run. The explicit
  -- historical snapshot is then written separately and cannot be overwritten
  -- by catalogue metadata, including intentional NULL taxonomy values.
  update public.items
     set product_id = v_target_product_id
   where id = v_item.id;

  update public.items
     set product_name = btrim(p_product_name),
         category = p_category,
         product_family_id = p_product_family_id,
         product_variant_id = p_product_variant_id
   where id = v_item.id
  returning * into v_item;

  if p_remember_rule then
    insert into public.product_match_rules (
      store_key, raw_product_name_key, product_id, product_name, category,
      product_family_id, product_variant_id
    )
    values (
      public.normalize_product_match_key(v_store),
      public.normalize_product_match_key(v_item.raw_product_name),
      v_target_product_id, btrim(p_product_name), p_category,
      p_product_family_id, p_product_variant_id
    )
    on conflict (store_key, raw_product_name_key)
    do update set
      product_id = excluded.product_id,
      product_name = excluded.product_name,
      category = excluded.category,
      product_family_id = excluded.product_family_id,
      product_variant_id = excluded.product_variant_id;
  end if;

  return v_item;
end;
$$;
revoke all on function public.correct_purchase_classification(text, text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.correct_purchase_classification(text, text, text, text, text, text, boolean)
  to authenticated, service_role;

comment on function public.correct_purchase_classification(text, text, text, text, text, text, boolean) is
  'Atomically corrects one historical purchase and, optionally, remembers an exact normalized label + store rule for later item inserts under caller RLS.';
