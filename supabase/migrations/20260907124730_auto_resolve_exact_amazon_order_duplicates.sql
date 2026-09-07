-- An identical Amazon order ID is stronger evidence than the receipt-like
-- date/time heuristic. The previous pasted-JSON finalizer found that exact
-- match but incorrectly surfaced it as a possible duplicate.
alter function public.finalize_pasted_json_import(text, bigint, jsonb, jsonb, jsonb)
  rename to finalize_pasted_json_import_review_duplicate;

create function public.finalize_pasted_json_import(
  p_file_id text,
  p_msg_id bigint,
  p_receipt jsonb,
  p_items jsonb,
  p_parsed_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.receipt_import_files%rowtype;
  v_duplicate_id text;
  v_merchant_order_id text := nullif(p_receipt ->> 'merchant_order_id', '');
begin
  select f.* into v_file
  from public.receipt_import_files f
  where f.id = p_file_id
  for update of f;

  if not found or v_file.storage_path is not null or v_file.manual_json is null then
    raise exception 'Pasted JSON import metadata unavailable';
  end if;
  if v_file.receipt_id is not null then
    perform pgmq.archive('receipt_imports', p_msg_id);
    return jsonb_build_object('status', 'saved', 'receipt_id', v_file.receipt_id);
  end if;
  if v_file.status <> 'processing' then
    raise exception 'Import file is not processing';
  end if;

  if not v_file.skip_duplicate_check and v_merchant_order_id is not null then
    -- Serialize the lookup and receipt insert path so parallel deliveries of
    -- one Amazon order cannot create a second expense.
    perform pg_advisory_xact_lock(
      hashtextextended((p_receipt ->> 'store') || '|' || v_merchant_order_id, 0)
    );
    select r.id into v_duplicate_id
    from public.receipts r
    where lower(trim(r.store)) = lower(trim(p_receipt ->> 'store'))
      and r.merchant_order_id = v_merchant_order_id
    order by r.created_at desc
    limit 1;

    if v_duplicate_id is not null then
      update public.receipt_import_files
      set status = 'saved', document_kind = 'receipt', parsed_json = p_parsed_json,
          receipt_id = v_duplicate_id, duplicate_receipt_id = v_duplicate_id,
          exception_kind = null, error_message = null, processed_at = now()
      where id = p_file_id;
      perform pgmq.archive('receipt_imports', p_msg_id);
      return jsonb_build_object(
        'status', 'saved',
        'receipt_id', v_duplicate_id,
        'auto_duplicate', true
      );
    end if;
  end if;

  return public.finalize_pasted_json_import_review_duplicate(
    p_file_id,
    p_msg_id,
    p_receipt,
    p_items,
    p_parsed_json
  );
end;
$$;

revoke execute on function public.finalize_pasted_json_import(text, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_pasted_json_import(text, bigint, jsonb, jsonb, jsonb)
  to service_role;

-- Repair records already held for review solely because their Amazon order ID
-- is identical to a saved receipt. Keep duplicate_receipt_id as audit proof.
update public.receipt_import_files f
set status = 'saved',
    receipt_id = r.id,
    duplicate_receipt_id = r.id,
    exception_kind = null,
    error_message = null,
    processed_at = now()
from public.receipts r
where f.status = 'needs_review'
  and f.exception_kind = 'possible_duplicate'
  and nullif(f.parsed_json ->> 'merchant_order_id', '') is not null
  and lower(trim(f.parsed_json ->> 'store')) = lower(trim(r.store))
  and r.merchant_order_id = f.parsed_json ->> 'merchant_order_id';
