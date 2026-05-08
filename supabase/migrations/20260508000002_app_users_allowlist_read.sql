-- Widen app_users read policy: any allowlisted user may read every row.
-- The "Оплатив" / paid_by dropdown in the receipt form needs the full list of
-- candidate payers, so the previous self-only policy is too narrow.
-- Mutations still go through Studio (no insert/update/delete policy = denied).

drop policy if exists "self_read_app_users" on public.app_users;

create policy "allowlist_read_app_users" on public.app_users
  for select using (public.is_allowed_user());
