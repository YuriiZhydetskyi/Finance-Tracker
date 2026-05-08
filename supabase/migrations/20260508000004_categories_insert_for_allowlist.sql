-- Allow allowlisted users to insert new categories from the app UI.
-- Until now categories were mutate-via-Studio only (per initial_schema policy).
-- The "Create new category" UI on the item-row category picker writes here.
-- Update/delete remain Studio-only — categories.name is referenced by items
-- and products via FK with `on update cascade`, but accidental deletion
-- through the app would silently break references; we keep that path off-app.

create policy "allowlist_insert_categories" on public.categories
  for insert with check (public.is_allowed_user());
