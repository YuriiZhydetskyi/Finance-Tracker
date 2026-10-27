-- Why a store row is marked "no packaging" (ADR-0034).
--
-- products.packaging_not_applicable has so far been a bare boolean set by hand.
-- Rows flagged by a rule (20261027120500) must be told apart from rows the owner
-- flagged themselves, otherwise a wrong rule cannot be undone without also
-- undoing every deliberate choice. NULL means "set by hand".

alter table public.products
  add column packaging_not_applicable_reason text
    check (packaging_not_applicable_reason is null or btrim(packaging_not_applicable_reason) <> ''),
  add constraint products_na_reason_requires_flag
    check (packaging_not_applicable_reason is null or packaging_not_applicable);

comment on column public.products.packaging_not_applicable_reason is
  'Set only by apply_packaging_exclusion_rule(): the rule that flagged the row (weighed, deposit, bag, service). NULL = flagged by hand or not flagged. Cleared whenever the flag is cleared.';

-- "Повернути в чергу" in the UI only flips the boolean; the reason follows it.
create function public.clear_packaging_na_reason()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not new.packaging_not_applicable then
    new.packaging_not_applicable_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_packaging_na_reason() from public, anon, authenticated;

create trigger trg_products_clear_packaging_na_reason
  before insert or update of packaging_not_applicable on public.products
  for each row execute function public.clear_packaging_na_reason();
