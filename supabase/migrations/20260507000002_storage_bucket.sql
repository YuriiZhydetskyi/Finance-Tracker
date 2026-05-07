-- Receipt photos bucket. Private (no anonymous reads); access gated by the same
-- email allowlist that protects data tables. Both users see all photos — this
-- is a two-person finance tracker, not a multi-tenant app.
--
-- Path scheme (enforced by client, not by policy): `{email}/{yyyy}/{mm}/{ulid}.jpg`.

insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- storage.objects already has RLS on by default in Supabase. Add policies
-- scoped to bucket_id = 'receipts' and gated by the existing helper.

create policy "allowlist_read_receipt_photos" on storage.objects
  for select
  using (bucket_id = 'receipts' and public.is_allowed_user());

create policy "allowlist_insert_receipt_photos" on storage.objects
  for insert
  with check (bucket_id = 'receipts' and public.is_allowed_user());

create policy "allowlist_update_receipt_photos" on storage.objects
  for update
  using (bucket_id = 'receipts' and public.is_allowed_user())
  with check (bucket_id = 'receipts' and public.is_allowed_user());

create policy "allowlist_delete_receipt_photos" on storage.objects
  for delete
  using (bucket_id = 'receipts' and public.is_allowed_user());
