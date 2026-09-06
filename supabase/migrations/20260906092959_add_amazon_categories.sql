-- Amazon purchases contain recurring product types not represented in the
-- original general-purpose catalog. Keep these additions idempotent so linked
-- environments and fresh local resets converge on the same category names.
insert into public.categories (name, group_name) values
  ('Дім і ремонт', 'Побут')
on conflict (name) do nothing;
