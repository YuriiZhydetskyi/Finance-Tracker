-- The seven files below were manually checked against their original EDEKA
-- purchase overview and the newly-imported PDF. They are the same purchase.
-- EDEKA prints a fiscal cash-register timestamp and a separate card-payment
-- timestamp which can differ by one minute. The historical overview and the
-- fiscal receipt agree; preserve that fiscal timestamp as the canonical one.
--
-- Three legacy rows lost an otherwise visible time during their original OCR.
-- Keep the imported parsed_json untouched as the provider audit record, while
-- resolving the verified import file to its existing canonical receipt.
do $$
declare
  v_times_filled integer;
  v_files_resolved integer;
begin
  update public.receipts as r
  set time = expected.time
  from (
    values
      ('01KR6AM6219G1N32RXQ4RFHK1G'::text, '2026-05-06'::date, '20:14:00'::time, 3.73::numeric),
      ('01KR6AQ2245ADGVTH6AB1DHD6Y'::text, '2026-05-08'::date, '21:04:00'::time, 22.03::numeric),
      ('01KR6ASP275K5Z5K6Y0GE5AE31'::text, '2026-05-09'::date, '13:07:00'::time, 32.40::numeric)
  ) as expected(id, date, time, total_orig)
  where r.id = expected.id
    and r.date = expected.date
    and r.total_orig = expected.total_orig
    and r.time is null;

  get diagnostics v_times_filled = row_count;
  if v_times_filled <> 3 then
    raise exception 'Expected to fill exactly 3 verified legacy receipt times, filled %', v_times_filled;
  end if;

  update public.receipt_import_files as f
  set status = 'saved',
      document_kind = 'receipt',
      receipt_id = expected.receipt_id,
      exception_kind = null,
      error_message = null,
      processed_at = now()
  from (
    values
      ('01M1F08RG274QEF8X688QMFB1D'::text, '01KTEH20M2J28HHWW9JGV6X0DF'::text, '2026-05-02', '14:06', 33.44::numeric),
      ('01M1F08RG07R91HVQGDK59S59K'::text, '01KR6AM6219G1N32RXQ4RFHK1G'::text, '2026-05-06', '20:14', 3.73::numeric),
      ('01M1F08RFX2WHRDYP1XTGKDWGQ'::text, '01KR6AQ2245ADGVTH6AB1DHD6Y'::text, '2026-05-08', '21:04', 22.03::numeric),
      ('01M1F08RFWH1MTT5JN6CN0GFBN'::text, '01KR6ASP275K5Z5K6Y0GE5AE31'::text, '2026-05-09', '13:07', 32.40::numeric),
      ('01M1F08RFV9HJ55HFCREZTH8FY'::text, '01KTEH4KYRBDDWNJWBNK12FECM'::text, '2026-05-13', '19:53', 15.29::numeric),
      ('01M1F08RFSBRYC3E19GNBJK7ZB'::text, '01KTEH60JWT0XMMTGX8HXRFKSX'::text, '2026-05-23', '14:46', 32.52::numeric),
      ('01M1F08RFRN6T82X4Y7TG19ZYW'::text, '01KTEH64K3VT3EQ5BT2T4A7EK4'::text, '2026-05-26', '07:30', 3.89::numeric)
  ) as expected(file_id, receipt_id, parsed_date, parsed_time, parsed_total)
  where f.id = expected.file_id
    and f.batch_id = '01M1F08RG2WQS5EBM70M4DZ2Z2'
    and f.status = 'needs_review'
    and f.exception_kind = 'possible_duplicate'
    and f.receipt_id is null
    and f.duplicate_receipt_id = expected.receipt_id
    and f.parsed_json ->> 'date' = expected.parsed_date
    and f.parsed_json ->> 'time' = expected.parsed_time
    and (f.parsed_json ->> 'total_orig')::numeric = expected.parsed_total;

  get diagnostics v_files_resolved = row_count;
  if v_files_resolved <> 7 then
    raise exception 'Expected to resolve exactly 7 verified import duplicates, resolved %', v_files_resolved;
  end if;
end;
$$;
