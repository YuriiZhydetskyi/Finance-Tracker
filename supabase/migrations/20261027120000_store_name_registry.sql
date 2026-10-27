-- Canonical store names (ADR-0033).
--
-- products.store and receipts.store are free text, and every identity check
-- (unique indexes, ON CONFLICT arbiters, the importers' lookups, the receipt
-- duplicate check) compares them byte for byte. "ALDI SÜD" and "Aldi Süd" were
-- therefore two stores with two product rows for each article.
--
-- This migration only adds the vocabulary: a registry of canonical spellings,
-- chain patterns, and the functions that map any spelling to its canonical one.
-- It changes no existing row and installs no trigger; the data fix is
-- 20261027120300, the write-path enforcement 20261027120400.

-- ── Key ─────────────────────────────────────────────────────────────────────
-- What two spellings of one shop have in common: no case, no diacritics, no
-- punctuation, one space between words. Accents are folded with translate(), not
-- extensions.unaccent(), because unaccent is STABLE and this must be IMMUTABLE;
-- the accented capitals are folded before lower() so the Latin result does not
-- depend on the database locale. Everything outside the table (Cyrillic, CJK) is
-- kept (and lower-cased where the locale can), so unrelated non-Latin shops never
-- collapse into one key.
create function public.normalize_store_key(p_value text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(translate(
      replace(replace(coalesce(p_value, ''), 'ß', 'ss'), 'ẞ', 'ss'),
      'ÀÁÂÃÄÅÇĆČĎÈÉÊËĘĚÌÍÎÏŁÑŃŇÒÓÔÕÖØŐŘŚŠŤÙÚÛÜŮŰÝŸŹŽŻĂȘŞȚŢĞàáâãäåçćčďèéêëęěìíîïłñńňòóôõöøőřśšťùúûüůűýÿźžżășşțţğİı',
      'AAAAAACCCDEEEEEEIIIILNNNOOOOOOORSSTUUUUUUYYZZZASSTTGaaaaaacccdeeeeeeiiiilnnnooooooorsstuuuuuuyyzzzassttgIi'
    )),
    '[[:space:][:punct:]]+', ' ', 'g'
  ));
$$;

revoke all on function public.normalize_store_key(text) from public, anon, authenticated;
grant execute on function public.normalize_store_key(text) to authenticated, service_role;

comment on function public.normalize_store_key(text) is
  'Spelling-independent store key: diacritics folded (ß = ss), lower case, punctuation and runs of spaces become one space. ALDI SÜD, Aldi Süd and "aldi  süd." share the key "aldi sud".';

-- ── Registry ────────────────────────────────────────────────────────────────
-- One row per store the app has seen: the key and the spelling that was seen
-- first. That spelling is what every later spelling is rewritten to.
create table public.store_name_registry (
  store_key      text primary key
                   check (store_key <> '' and store_key = public.normalize_store_key(store_key)),
  canonical_name text not null
                   check (canonical_name <> '' and canonical_name = btrim(canonical_name)),
  created_at     timestamptz not null default now()
);

comment on table public.store_name_registry is
  'normalize_store_key(raw) -> canonical spelling. Rows appear automatically on first sight (register_store_name); edit canonical_name here to rename a store, then update products/receipts to match.';

-- Chain rules for names that are not spelling variants of one another: a shop
-- brand printed with an operator or a legal form ("REWE <operator> oHG",
-- "ORLEN S.A."). pattern is a POSIX regular expression tested against
-- normalize_store_key(raw). Branches stay separate stores only where no pattern
-- matches (EDEKA Straßfeld and Marktkauf Frechen are different stores).
create table public.store_name_patterns (
  pattern        text primary key check (('' ~ pattern) is not null),
  canonical_name text not null
                   check (canonical_name <> '' and canonical_name = btrim(canonical_name)),
  created_at     timestamptz not null default now()
);

comment on table public.store_name_patterns is
  'Chain aliases as data. A store whose key matches pattern is stored under canonical_name. An exact store_name_registry row wins over a pattern; of several patterns the longest wins.';

-- Generic brand patterns only: no operator, franchisee or branch is named in the
-- repository (it is public). The owner adds anything more specific from Studio.
insert into public.store_name_patterns (pattern, canonical_name) values
  ('^aldi( sud| sued)?$',        'ALDI SÜD'),
  ('^netto( marken discount)?$', 'Netto'),
  ('(^| )rewe( |$)',             'REWE'),
  ('^avex( |$)',                 'AVEX'),
  ('^orlen( |$)',                'ORLEN');

alter table public.store_name_registry enable row level security;
alter table public.store_name_patterns enable row level security;

revoke all on public.store_name_registry, public.store_name_patterns from public, anon, authenticated;
-- The app reads both and may only add a first-seen registry row (register_store_name
-- runs as the caller); renaming and patterns are owner work in Studio.
grant select, insert on public.store_name_registry to authenticated;
grant select on public.store_name_patterns to authenticated;
grant all on public.store_name_registry, public.store_name_patterns to service_role;

create policy allowlist_select_store_name_registry on public.store_name_registry
  for select to authenticated
  using ((select public.is_allowed_user()));

create policy allowlist_insert_store_name_registry on public.store_name_registry
  for insert to authenticated
  with check ((select public.is_allowed_user()));

create policy allowlist_select_store_name_patterns on public.store_name_patterns
  for select to authenticated
  using ((select public.is_allowed_user()));

-- ── Lookup and registration ─────────────────────────────────────────────────
create function public.lookup_store_name(p_key text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select r.canonical_name from public.store_name_registry r where r.store_key = p_key),
    (select p.canonical_name
       from public.store_name_patterns p
      where p_key ~ p.pattern
      order by length(p.pattern) desc, p.pattern
      limit 1)
  );
$$;

revoke all on function public.lookup_store_name(text) from public, anon, authenticated;
grant execute on function public.lookup_store_name(text) to authenticated, service_role;

-- Read-only: what this spelling is called, without remembering it. The browser
-- calls it while a form is being filled in, so half-typed names leave no trace.
-- An unknown store keeps its own spelling (trimmed, inner spaces collapsed).
create function public.canonical_store_name(p_store text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    public.lookup_store_name(public.normalize_store_key(p_store)),
    btrim(regexp_replace(coalesce(p_store, ''), '[[:space:]]+', ' ', 'g'))
  );
$$;

revoke all on function public.canonical_store_name(text) from public, anon, authenticated;
grant execute on function public.canonical_store_name(text) to authenticated, service_role;

comment on function public.canonical_store_name(text) is
  'Canonical spelling of a store: registry row, else chain pattern, else the input trimmed. Writes nothing.';

-- The write-side twin: an unknown store is remembered under its own spelling, so
-- the first spelling ever seen is the one every later spelling resolves to.
create function public.register_store_name(p_store text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_display text := btrim(regexp_replace(coalesce(p_store, ''), '[[:space:]]+', ' ', 'g'));
  v_key     text := public.normalize_store_key(p_store);
  v_name    text;
begin
  if v_key = '' then
    return v_display;
  end if;
  v_name := public.lookup_store_name(v_key);
  if v_name is not null then
    return v_name;
  end if;
  -- Two sessions meeting the same new store: the second insert waits for the
  -- first to commit, does nothing, and reads the first writer's spelling.
  insert into public.store_name_registry (store_key, canonical_name)
  values (v_key, v_display)
  on conflict (store_key) do nothing;
  return (select r.canonical_name from public.store_name_registry r where r.store_key = v_key);
end;
$$;

revoke all on function public.register_store_name(text) from public, anon, authenticated;
grant execute on function public.register_store_name(text) to authenticated, service_role;

comment on function public.register_store_name(text) is
  'Like canonical_name, but an unknown store is added to store_name_registry under its own spelling (first seen wins).';

-- Remember the spelling a receipt carried when it differs from the canonical one
-- (chain operator, legal form, case); the canonical name alone would lose it.
alter table public.receipts
  add column store_printed text check (store_printed is null or btrim(store_printed) <> '');

comment on column public.receipts.store_printed is
  'The store spelling as entered or printed, kept only when it differs from receipts.store (the canonical name).';

-- ── Seed the registry from what the database has already seen ───────────────
-- Oldest spelling first, so the first-seen rule holds retroactively. Chain
-- patterns above already resolve the chains; this adds every other store.
do $$
declare
  v_spelling record;
  v_before   integer;
begin
  select count(*) into v_before from public.store_name_registry;

  for v_spelling in
    select seen.store
      from (
        select p.store, min(p.created_at) as first_seen from public.products p group by p.store
        union all
        select r.store, min(r.created_at) from public.receipts r group by r.store
      ) seen
     group by seen.store
     order by min(seen.first_seen), seen.store
  loop
    perform public.register_store_name(v_spelling.store);
  end loop;

  raise notice 'store_name_registry: % row(s) added from existing products and receipts',
    (select count(*) from public.store_name_registry) - v_before;
end;
$$;
