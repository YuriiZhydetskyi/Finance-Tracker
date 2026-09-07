-- Keep intimate products separate from general personal hygiene while retaining
-- the existing household reporting group used by comparable everyday purchases.
insert into public.categories (name, group_name) values
  ('Інтимні товари', 'Побут')
on conflict (name) do nothing;
