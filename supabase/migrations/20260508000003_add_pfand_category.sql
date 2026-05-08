-- Add Pfand category for German bottle-deposit lines.
-- Documented as a recommended addition in docs/data-model.md and docs/extending.md.
-- Gemini prompt will auto-assign category_suggestion='Pfand' to deposit/Leergut rows
-- when this name is present in the allowed-categories list.

insert into public.categories (name, group_name) values
  ('Pfand', 'Інше')
on conflict (name) do nothing;
