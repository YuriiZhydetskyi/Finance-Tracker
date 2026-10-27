-- "Потрібна перевірка": human-readable reasons why a packaged product card still
-- needs a manual check (blurry barcode, ambiguous receipt match, missing label
-- panel). The card stays fully usable; the notes only tell the owner what to verify.
--
-- A non-empty array IS the marker. A separate boolean would be a second source of
-- truth that can drift from the notes, and the whole catalogue (hundreds of rows)
-- is filtered in the browser, so there is no partial index either. See ADR-0030.

-- CHECK cannot contain a subquery, so the per-element rules live in a pure
-- immutable function. Limits mirror REVIEW_NOTE_MAX_LENGTH / CARD_REVIEW_NOTES_MAX
-- in packages/domain/src/review-notes.ts. The card limit (50) is deliberately above
-- the per-import limit (10): merging repeated imports into a reused card must
-- never have to drop a note.
create function public.is_valid_review_notes(p_notes text[])
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select p_notes is not null
     and cardinality(p_notes) <= 50
     and not exists (
       select 1
         from unnest(p_notes) as note
        where note is null
           or note <> btrim(note)
           or char_length(note) not between 1 and 300
     )
$$;
revoke all on function public.is_valid_review_notes(text[]) from public, anon, authenticated;
grant execute on function public.is_valid_review_notes(text[]) to authenticated, service_role;

comment on function public.is_valid_review_notes(text[]) is
  'Review notes rule: at most 50 notes, each trimmed and 1..300 characters. Used by a CHECK on packaged_products.';

alter table public.packaged_products
  add column review_notes text[] not null default '{}',
  add constraint packaged_products_review_notes_valid
    check (public.is_valid_review_notes(review_notes));

comment on column public.packaged_products.review_notes is
  'Reasons the card needs a manual check, free text (Ukrainian). Empty array = nothing to check. Marking a note as checked removes it from the array. Import merges new notes into a reused card without duplicates and never overwrites nutrition or name.';
