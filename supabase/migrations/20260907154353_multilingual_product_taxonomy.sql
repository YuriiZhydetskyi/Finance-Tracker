create extension if not exists unaccent with schema extensions;

create table public.product_families (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name_uk text not null check (btrim(name_uk) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  name_de text not null check (btrim(name_de) <> ''),
  aliases text[] not null default '{}'
);

create table public.product_variants (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  family_id text not null references public.product_families(id),
  name_uk text not null check (btrim(name_uk) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  name_de text not null check (btrim(name_de) <> ''),
  aliases text[] not null default '{}',
  unique (id, family_id)
);
create index idx_product_variants_family on public.product_variants (family_id);

alter table public.categories
  add column name_en text check (name_en is null or btrim(name_en) <> ''),
  add column name_de text check (name_de is null or btrim(name_de) <> ''),
  add column aliases text[] not null default '{}';

update public.categories c
set name_en = translations.name_en,
    name_de = translations.name_de,
    aliases = translations.aliases
from (values
  ('Молочка', 'Dairy', 'Milchprodukte', array['молочні продукти', 'dairy products']),
  ('М''ясо/риба', 'Meat and fish', 'Fleisch und Fisch', array['м’ясо', 'риба', 'meat', 'fish']),
  ('Овочі/фрукти', 'Vegetables and fruit', 'Gemüse und Obst', array['овочі', 'фрукти', 'vegetables', 'fruits']),
  ('Бакалія', 'Pantry', 'Vorratsprodukte', array['groceries', 'dry goods', 'бакалійні товари']),
  ('Солодке', 'Sweets', 'Süßwaren', array['солодощі', 'confectionery', 'Suessigkeiten']),
  ('Алкоголь', 'Alcohol', 'Alkohol', array['alcoholic drinks', 'алкогольні напої']),
  ('Хімія/гігієна', 'Cleaning and hygiene', 'Reinigung und Hygiene', array['побутова хімія', 'гігієна', 'toiletries']),
  ('Аптека', 'Pharmacy', 'Apotheke', array['ліки', 'medicine', 'Medikamente']),
  ('Одяг', 'Clothing', 'Kleidung', array['clothes', 'одежа', 'Bekleidung']),
  ('Електроніка', 'Electronics', 'Elektronik', array['електротовари']),
  ('Оренда житла', 'Rent', 'Miete', array['housing rent', 'оренда']),
  ('Комуналка', 'Utilities', 'Nebenkosten', array['комунальні послуги', 'utility bills']),
  ('Авто', 'Car', 'Auto', array['автомобіль', 'automotive', 'Fahrzeug']),
  ('Транспорт', 'Transport', 'Verkehr', array['transportation', 'public transport', 'Nahverkehr']),
  ('Кафе/ресторани', 'Cafes and restaurants', 'Cafés und Restaurants', array['кафе', 'ресторани', 'dining out', 'Gastronomie']),
  ('Розваги', 'Entertainment', 'Unterhaltung', array['leisure', 'Freizeit']),
  ('Курси/освіта', 'Courses and education', 'Kurse und Bildung', array['навчання', 'освіта', 'education']),
  ('Підписки', 'Subscriptions', 'Abonnements', array['subscription', 'Abo']),
  ('Послуги', 'Services', 'Dienstleistungen', array['service', 'Dienstleistung']),
  ('Інше', 'Other', 'Sonstiges', array['miscellaneous']),
  ('Pfand', 'Bottle deposit', 'Pfand', array['застава за тару', 'Leergut', 'deposit']),
  ('Дім і ремонт', 'Home and DIY', 'Wohnen und Heimwerken', array['ремонт', 'household', 'home improvement', 'Renovierung']),
  ('Інтимні товари', 'Intimate products', 'Intimprodukte', array['sexual wellness', 'інтимні засоби'])
) as translations(name, name_en, name_de, aliases)
where c.name = translations.name;

alter table public.products
  add column product_family_id text references public.product_families(id),
  add column product_variant_id text,
  add column brand text check (brand is null or btrim(brand) <> ''),
  add column is_organic boolean,
  add constraint products_variant_requires_family
    check (product_variant_id is null or product_family_id is not null),
  add constraint products_variant_family_fkey
    foreign key (product_variant_id, product_family_id)
    references public.product_variants(id, family_id);

alter table public.items
  add column product_family_id text references public.product_families(id),
  add column product_variant_id text,
  add constraint items_variant_requires_family
    check (product_variant_id is null or product_family_id is not null),
  add constraint items_variant_family_fkey
    foreign key (product_variant_id, product_family_id)
    references public.product_variants(id, family_id);

create index idx_products_product_family on public.products (product_family_id);
create index idx_products_product_variant_family
  on public.products (product_variant_id, product_family_id);
create index idx_items_product_family on public.items (product_family_id);
create index idx_items_product_variant_family
  on public.items (product_variant_id, product_family_id);

alter table public.product_families enable row level security;
alter table public.product_variants enable row level security;
revoke all on public.product_families, public.product_variants from public, anon, authenticated;
grant select, insert, update, delete on public.product_families, public.product_variants to authenticated;
grant all on public.product_families, public.product_variants to service_role;

create policy allowlist_all_product_families on public.product_families
  for all to authenticated
  using ((select public.is_allowed_user()))
  with check ((select public.is_allowed_user()));
create policy allowlist_all_product_variants on public.product_variants
  for all to authenticated
  using ((select public.is_allowed_user()))
  with check ((select public.is_allowed_user()));

create function public.inherit_item_product_taxonomy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Unlinking (including ON DELETE SET NULL) does not change the purchased identity.
    if new.product_id is null or new.product_id is not distinct from old.product_id then
      return new;
    end if;
    -- Retaining the old values while reassigning a product must not retain its taxonomy.
    if new.product_family_id is not distinct from old.product_family_id
       and new.product_variant_id is not distinct from old.product_variant_id then
      new.product_family_id := null;
      new.product_variant_id := null;
    end if;
  end if;

  -- A family-only snapshot is deliberate; do not attach a catalogue variant to it.
  if new.product_id is not null
     and new.product_family_id is null and new.product_variant_id is null then
    select p.product_family_id, p.product_variant_id
      into new.product_family_id, new.product_variant_id
      from public.products p where p.id = new.product_id;
  end if;
  return new;
end;
$$;
revoke all on function public.inherit_item_product_taxonomy() from public, anon, authenticated;

create trigger trg_items_inherit_product_taxonomy
  before insert or update of product_id on public.items
  for each row execute function public.inherit_item_product_taxonomy();

-- Keep matching language-neutral: aliases supply grammatical forms, not language stemmers.
-- Umlaut transliteration also accepts keyboard spellings such as "Aepfel" and "Kaese".
create function public.normalize_product_search(p_value text)
returns text
language sql
stable
parallel safe
security invoker
set search_path = ''
as $$
  select btrim(regexp_replace(
    extensions.unaccent(replace(replace(replace(replace(
      lower(coalesce(p_value, '')), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')),
    '[[:space:].,;:/()\[\]{}+!?"''’`–—-]+', ' ', 'g'
  ));
$$;
revoke all on function public.normalize_product_search(text) from public, anon, authenticated;
grant execute on function public.normalize_product_search(text) to authenticated, service_role;

create function public.search_waste_items(p_query text default '')
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  select i.*
  from public.items i
  left join public.products p on p.id = i.product_id
  left join public.product_families f
    on f.id = coalesce(i.product_family_id, p.product_family_id)
  left join public.product_variants v
    on v.id = case when i.product_family_id is not null
      then i.product_variant_id else p.product_variant_id end
    and v.family_id = f.id
  left join public.categories c on c.name = i.category
  cross join lateral (
    select public.normalize_product_search(concat_ws(' ',
      i.product_name, i.store_product_code, p.name, p.store, p.store_product_code, p.brand,
      f.name_uk, f.name_en, f.name_de, array_to_string(f.aliases, ' '),
      v.name_uk, v.name_en, v.name_de, array_to_string(v.aliases, ' '),
      c.name, c.name_en, c.name_de, array_to_string(c.aliases, ' '),
      case when p.is_organic then 'bio organic органічний органічне органічні біо ökologisch' end
    )) as document
  ) searchable
  where i.total_orig > 0
    and not exists (
      select 1
      from unnest(string_to_array(public.normalize_product_search(p_query), ' ')) as tokens(token)
      -- strpos treats user-supplied %, _ and backslashes as literals, never LIKE syntax.
      where token <> '' and strpos(searchable.document, token) = 0
        -- Whole-token aliases avoid making "organic" match the substring in "nonorganic".
        and not (p.is_organic is false and token = any (array[
          'звичайне', 'звичайний', 'звичайні', 'небіо', 'nonbio', 'nonorganic', 'konventionell'
        ]))
    );
$$;
revoke all on function public.search_waste_items(text) from public, anon, authenticated;
grant execute on function public.search_waste_items(text) to authenticated, service_role;

comment on column public.items.product_family_id is
  'Purchase taxonomy snapshot. NULL permits catalogue fallback for unclassified historical items.';
comment on column public.items.product_variant_id is
  'Optional purchase variant within product_family_id. A family-only snapshot never inherits a catalogue variant during search.';
comment on function public.search_waste_items(text) is
  'All positive purchase items matching every normalized literal token in multilingual taxonomy or product text, subject to caller RLS. Caller applies receipt joins, filters and pagination.';
