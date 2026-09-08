-- The item trigger can replace the resolver's product_id. Both durable
-- finalizers insert an item and then its price inside the same loop, so use
-- the returned (post-trigger) id rather than the pre-insert resolver value.
-- Deriving the current body avoids resurrecting stale duplicate/import logic.

do $$
declare
  v_function regprocedure;
  v_definition text;
  v_before text := E'      0, (v_item ->> ''discount_orig'')::numeric\n    );\n\n    insert into public.product_prices';
  v_after text := E'      0, (v_item ->> ''discount_orig'')::numeric\n    ) returning product_id into v_product_id;\n\n    insert into public.product_prices';
begin
  foreach v_function in array array[
    'public.finalize_receipt_import(text,bigint,jsonb,jsonb,jsonb)'::regprocedure,
    'public.finalize_pasted_json_import_review_duplicate(text,bigint,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    v_definition := replace(v_definition, E'\r\n', E'\n');
    if position(v_before in v_definition) = 0 then
      raise exception 'Could not locate item insert in %', v_function::text;
    end if;
    execute replace(v_definition, v_before, v_after);
  end loop;
end;
$$;
