-- Packaging photos bucket. Separate from `receipts` because the lifecycle differs:
-- N photos per product, removed when the packaged product is deleted, and the
-- source PDF the user fed to an external AI is worth archiving alongside them.
--
-- Path scheme (enforced by the client, not by policy):
--   `{email}/{packaged_product_id}/{ulid}.{ext}`

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'packaging', 'packaging', false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "allowlist_read_packaging_photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'packaging' and (select public.is_allowed_user()));

create policy "allowlist_insert_packaging_photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'packaging' and (select public.is_allowed_user()));

create policy "allowlist_update_packaging_photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'packaging' and (select public.is_allowed_user()))
  with check (bucket_id = 'packaging' and (select public.is_allowed_user()));

create policy "allowlist_delete_packaging_photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'packaging' and (select public.is_allowed_user()));
