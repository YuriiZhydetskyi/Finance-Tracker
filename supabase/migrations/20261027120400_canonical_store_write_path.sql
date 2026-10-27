-- Write-path enforcement for ADR-0033: no row can be written under a
-- non-canonical store name, whoever writes it.
--
-- Two layers, because a trigger alone is a trap. A BEFORE trigger rewrites
-- store after the writer has already looked the product up by the raw spelling,
-- so the lookup misses the canonical row and the insert then hits the unique
-- index. The importers therefore canonicalise their input first (layer 1) and
-- the trigger is the backstop for every other writer (layer 2).

-- ── Layer 2: triggers ───────────────────────────────────────────────────────
create function public.canonicalize_product_store()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.store := public.register_store_name(new.store);
  return new;
end;
$$;

revoke all on function public.canonicalize_product_store() from public, anon, authenticated;

create trigger trg_products_canonical_store
  before insert or update of store on public.products
  for each row execute function public.canonicalize_product_store();

create function public.canonicalize_receipt_store()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_canonical text;
begin
  -- A replace-mode save that leaves the store alone must not forget what was printed.
  if tg_op = 'UPDATE' and new.store is not distinct from old.store then
    return new;
  end if;
  v_canonical := public.register_store_name(new.store);
  if v_canonical is distinct from new.store then
    new.store_printed := case when tg_op = 'INSERT'
      then coalesce(new.store_printed, new.store) else new.store end;
    new.store := v_canonical;
  elsif tg_op = 'UPDATE' then
    new.store_printed := null;
  end if;
  return new;
end;
$$;

revoke all on function public.canonicalize_receipt_store() from public, anon, authenticated;

create trigger trg_receipts_canonical_store
  before insert or update of store on public.receipts
  for each row execute function public.canonicalize_receipt_store();

-- ── Layer 1: the durable importers ──────────────────────────────────────────
-- finalize_receipt_import and finalize_pasted_json_import look a product up by
-- p_receipt ->> 'store', serialise on it with an advisory lock and compare it
-- with lower(trim(receipts.store)) in their duplicate checks. Replacing
-- p_receipt's store on entry fixes all of that without copying a function body.
-- The spelling the model printed is not lost: receipt_import_files.parsed_json
-- keeps the whole model output.
create function public.canonicalize_receipt_json(p_receipt jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select case
    when nullif(btrim(p_receipt ->> 'store'), '') is null then p_receipt
    else jsonb_set(p_receipt, '{store}', to_jsonb(public.register_store_name(p_receipt ->> 'store')))
  end;
$$;

revoke all on function public.canonicalize_receipt_json(jsonb) from public, anon, authenticated;
grant execute on function public.canonicalize_receipt_json(jsonb) to service_role;

comment on function public.canonicalize_receipt_json(jsonb) is
  'p_receipt with its store replaced by the canonical spelling (registering a new store on first sight). Called first thing by the durable import finalizers.';

-- Derive the current bodies instead of copying them (the same technique as
-- 20260908162225): the anchor is the first statement of each function.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_before text := E'begin\n  select f.* into v_file\n';
  v_after text := E'begin\n  p_receipt := public.canonicalize_receipt_json(p_receipt);\n  select f.* into v_file\n';
begin
  foreach v_function in array array[
    'public.finalize_receipt_import(text,bigint,jsonb,jsonb,jsonb)'::regprocedure,
    'public.finalize_pasted_json_import(text,bigint,jsonb,jsonb,jsonb)'::regprocedure,
    'public.finalize_pasted_json_import_review_duplicate(text,bigint,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    v_definition := replace(v_definition, E'\r\n', E'\n');
    if position(v_before in v_definition) = 0 then
      raise exception 'Could not locate the first statement of %', v_function::text;
    end if;
    execute replace(v_definition, v_before, v_after);
  end loop;
end;
$$;
