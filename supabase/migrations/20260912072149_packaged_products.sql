-- Пакований товар: a store-agnostic physical product identified by its packaging.
--
-- public.products stays the per-store receipt-label row; products.packaged_product_id
-- is the many-labels -> one-product mapping. A junction table would re-declare the
-- (store, code) / (store, name) identity that products already enforces, and would
-- add a second, unconstrained resolver next to product_match_rules. See ADR-0027.

create type public.nutrition_basis as enum ('per_100_g', 'per_100_ml');

-- The 14 allergens EU FIC 1169/2011 requires to be declared. An enum (rather than
-- text[] + check) puts the vocabulary into the generated TypeScript types.
create type public.eu_allergen as enum (
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts',
  'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'
);

create table public.packaged_products (
  id                  text primary key,
  name                text not null check (btrim(name) <> ''),
  brand               text check (brand is null or btrim(brand) <> ''),
  -- Nullable by design: existing products acquire barcodes over time, so it can
  -- never be the key. Format only -- the GTIN check digit is advisory, because
  -- in-store weight-embedded codes (2xxxxxxxxxxx) legitimately fail mod-10.
  barcode             text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  category            text not null references public.categories(name) on update cascade,
  product_family_id   text references public.product_families(id),
  product_variant_id  text,
  is_organic          boolean,

  package_size        numeric(10, 3) check (package_size is null or package_size > 0),
  package_unit        public.product_unit,
  package_count       integer        check (package_count is null or package_count > 0),
  serving_size        numeric(10, 3) check (serving_size is null or serving_size > 0),

  nutrition_basis     public.nutrition_basis,
  energy_kj           numeric(8, 1) check (energy_kj       is null or energy_kj       between 0 and 5000),
  energy_kcal         numeric(7, 1) check (energy_kcal     is null or energy_kcal     between 0 and 1200),
  fat_g               numeric(6, 3) check (fat_g           is null or fat_g           between 0 and 100),
  saturated_fat_g     numeric(6, 3) check (saturated_fat_g is null or saturated_fat_g between 0 and 100),
  carbohydrate_g      numeric(6, 3) check (carbohydrate_g  is null or carbohydrate_g  between 0 and 100),
  sugars_g            numeric(6, 3) check (sugars_g        is null or sugars_g        between 0 and 100),
  fibre_g             numeric(6, 3) check (fibre_g         is null or fibre_g         between 0 and 100),
  protein_g           numeric(6, 3) check (protein_g       is null or protein_g       between 0 and 100),
  salt_g              numeric(6, 3) check (salt_g          is null or salt_g          between 0 and 100),
  nutri_score         text check (nutri_score is null or nutri_score in ('A', 'B', 'C', 'D', 'E')),

  allergens           public.eu_allergen[] not null default '{}',
  allergen_traces     public.eu_allergen[] not null default '{}',
  ingredients_text    text,
  notes               text,

  import_source       text not null default 'manual-json'
                        check (import_source in ('manual-json', 'manual', 'edge-function')),
  raw_import_json     jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint packaged_products_variant_requires_family
    check (product_variant_id is null or product_family_id is not null),
  constraint packaged_products_variant_family_fkey
    foreign key (product_variant_id, product_family_id)
      references public.product_variants(id, family_id),

  constraint packaged_products_package_size_unit_together
    check ((package_size is null) = (package_unit is null)),

  -- A nutrient value is meaningless without the printed column it came from.
  constraint packaged_products_nutrition_requires_basis
    check (nutrition_basis is not null or num_nonnulls(
      energy_kj, energy_kcal, fat_g, saturated_fat_g, carbohydrate_g,
      sugars_g, fibre_g, protein_g, salt_g) = 0),

  -- Printed-label invariants. The 0.05 slack absorbs per-column rounding on the
  -- label itself; it is not a tolerance for transcription errors.
  constraint packaged_products_saturated_fat_within_fat
    check (saturated_fat_g is null or fat_g is null or saturated_fat_g <= fat_g + 0.05),
  constraint packaged_products_sugars_within_carbohydrate
    check (sugars_g is null or carbohydrate_g is null or sugars_g <= carbohydrate_g + 0.05)
);

create unique index packaged_products_barcode_uniq
  on public.packaged_products (barcode) where barcode is not null;

-- Mirrors products_store_name_nocode_uniq: without a barcode the display name is
-- the identity, so it must be distinct (include the net size in the name).
create unique index packaged_products_name_nobarcode_uniq
  on public.packaged_products (lower(btrim(name))) where barcode is null;

create index idx_packaged_products_name     on public.packaged_products (name);
create index idx_packaged_products_category on public.packaged_products (category);
create index idx_packaged_products_family   on public.packaged_products (product_family_id);
create index idx_packaged_products_variant_family
  on public.packaged_products (product_variant_id, product_family_id);

create table public.packaged_product_photos (
  id                  text primary key,
  packaged_product_id text not null references public.packaged_products(id) on delete cascade,
  -- Object path inside the private `packaging` bucket. The row cascades on delete;
  -- the Storage object is removed best-effort by the client mutation.
  storage_path        text not null unique check (btrim(storage_path) <> ''),
  kind                text not null default 'other' check (kind in
                        ('front', 'back', 'nutrition', 'ingredients', 'barcode', 'source_pdf', 'other')),
  content_type        text,
  byte_size           integer check (byte_size is null or byte_size > 0),
  sort_order          integer not null default 0,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_packaged_product_photos_product
  on public.packaged_product_photos (packaged_product_id, sort_order, created_at);

alter table public.products
  add column packaged_product_id text references public.packaged_products(id) on delete set null,
  -- Loose produce, counter bread, services and Pfand rows never get a packaging
  -- photo. Without this flag the photographing queue is permanent noise.
  add column packaging_not_applicable boolean not null default false;

create index idx_products_packaged_product
  on public.products (packaged_product_id) where packaged_product_id is not null;
create index idx_products_packaging_todo
  on public.products (category)
  where packaged_product_id is null and packaging_not_applicable = false;

create trigger trg_packaged_products_updated_at
  before update on public.packaged_products
  for each row execute function public.set_updated_at();

create trigger trg_packaged_product_photos_updated_at
  before update on public.packaged_product_photos
  for each row execute function public.set_updated_at();

alter table public.packaged_products       enable row level security;
alter table public.packaged_product_photos enable row level security;

revoke all on public.packaged_products, public.packaged_product_photos
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.packaged_products, public.packaged_product_photos to authenticated;
grant all on public.packaged_products, public.packaged_product_photos to service_role;

create policy allowlist_all_packaged_products on public.packaged_products
  for all to authenticated
  using ((select public.is_allowed_user()))
  with check ((select public.is_allowed_user()));

create policy allowlist_all_packaged_product_photos on public.packaged_product_photos
  for all to authenticated
  using ((select public.is_allowed_user()))
  with check ((select public.is_allowed_user()));

comment on table public.packaged_products is
  'Пакований товар: a store-agnostic physical product identified by its packaging. Barcode is nullable by design; identity is the ULID.';
comment on column public.packaged_products.nutrition_basis is
  'Which printed column the nutrient values were copied from. Values are never converted from a per-serving column.';
comment on column public.packaged_products.raw_import_json is
  'Verbatim JSON of the import that produced this row, so a later schema widening can re-read it without re-photographing the package.';
comment on column public.products.packaged_product_id is
  'The physical product this store label denotes. NULL means not identified yet; deleting the packaged product unlinks rather than cascades, so the label returns to the photographing queue.';
comment on column public.products.packaging_not_applicable is
  'Excludes loose produce, counter items, services and deposit rows from the photographing queue.';
