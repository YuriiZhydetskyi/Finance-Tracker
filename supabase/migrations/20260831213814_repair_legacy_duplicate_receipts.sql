-- Repair only manually verified legacy import records. The earlier parser omitted
-- the purchase time on these receipts; their later imports match the stored
-- receipt contents exactly. Keep raw_ocr_json unchanged as the original audit
-- artifact rather than rewriting historical OCR output.
do $$
declare
  v_repaired_times integer;
  v_resolved_files integer;
begin
  -- Fail closed if any receipt was changed after the review. A repair must not
  -- silently overwrite a user's later edit or apply to a similarly shaped row.
  if (
    select count(*)
    from public.receipts r
    join (
      values
        ('01KRHQWRRGD7RCK82FW2NWWQR8'::text, date '2026-05-13', 'EDEKA Straßfeld'::text, 'EUR'::text, 11.92::numeric, time '08:30'),
        ('01KRHQV7VVAEX717KMYFJN8WF7'::text, date '2026-05-12', 'ALDI SÜD'::text, 'EUR'::text, 10.90::numeric, time '19:51'),
        ('01KRQX13GP8G4RKP900S9BYN9C'::text, date '2026-05-15', 'ALDI SÜD'::text, 'EUR'::text, 48.50::numeric, time '20:13')
    ) as expected(id, receipt_date, store, currency, total_orig, receipt_time)
      on r.id = expected.id
    where r.date = expected.receipt_date
      and r.store = expected.store
      and r.currency = expected.currency
      and r.total_orig = expected.total_orig
      and r.time is null
  ) <> 3 then
    raise exception 'Legacy receipt time repair precondition failed';
  end if;

  update public.receipts r
  set time = expected.receipt_time
  from (
    values
      ('01KRHQWRRGD7RCK82FW2NWWQR8'::text, time '08:30'),
      ('01KRHQV7VVAEX717KMYFJN8WF7'::text, time '19:51'),
      ('01KRQX13GP8G4RKP900S9BYN9C'::text, time '20:13')
  ) as expected(id, receipt_time)
  where r.id = expected.id
    and r.time is null;

  get diagnostics v_repaired_times = row_count;
  if v_repaired_times <> 3 then
    raise exception 'Expected to repair 3 receipt times, repaired %', v_repaired_times;
  end if;

  -- Resolve exactly the three reviewed imports. duplicate_receipt_id remains as
  -- the audit link; receipt_id makes the saved file point to the canonical row.
  if (
    select count(*)
    from public.receipt_import_files f
    join (
      values
        ('01M1BKAQ982RHS3KTPZYVZNS4Z'::text, '01KRHQWRRGD7RCK82FW2NWWQR8'::text),
        ('01M1BKAQ9A6HTCSSEFRSNT03DN'::text, '01KRHQV7VVAEX717KMYFJN8WF7'::text),
        ('01M1BKAQ93FZPJ46NVXPH2BJ7C'::text, '01KRQX13GP8G4RKP900S9BYN9C'::text)
    ) as expected(file_id, receipt_id)
      on f.id = expected.file_id
    where f.status = 'needs_review'
      and f.exception_kind = 'possible_duplicate'
      and f.duplicate_receipt_id = expected.receipt_id
  ) <> 3 then
    raise exception 'Legacy duplicate resolution precondition failed';
  end if;

  update public.receipt_import_files f
  set status = 'saved',
      document_kind = 'receipt',
      receipt_id = expected.receipt_id,
      exception_kind = null,
      error_message = null,
      processed_at = now()
  from (
    values
      ('01M1BKAQ982RHS3KTPZYVZNS4Z'::text, '01KRHQWRRGD7RCK82FW2NWWQR8'::text),
      ('01M1BKAQ9A6HTCSSEFRSNT03DN'::text, '01KRHQV7VVAEX717KMYFJN8WF7'::text),
      ('01M1BKAQ93FZPJ46NVXPH2BJ7C'::text, '01KRQX13GP8G4RKP900S9BYN9C'::text)
  ) as expected(file_id, receipt_id)
  where f.id = expected.file_id
    and f.status = 'needs_review'
    and f.exception_kind = 'possible_duplicate'
    and f.duplicate_receipt_id = expected.receipt_id;

  get diagnostics v_resolved_files = row_count;
  if v_resolved_files <> 3 then
    raise exception 'Expected to resolve 3 duplicate import files, resolved %', v_resolved_files;
  end if;
end;
$$;
