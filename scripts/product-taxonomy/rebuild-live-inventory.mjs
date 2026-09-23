import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const outputRoot = resolve(process.cwd(), 'output');
const outputPath = resolve(
  process.cwd(),
  process.argv[2] ?? 'output/product-taxonomy/live-inventory.json',
);
// The snapshot holds live purchase data; keep it inside the gitignored output/.
if (!outputPath.startsWith(outputRoot + sep)) {
  throw new Error(`Output path must be inside ${outputRoot}: ${outputPath}`);
}

const query = String.raw`
  with item_rows as (
    select
      lower(regexp_replace(btrim(i.product_name), '\s+', ' ', 'g')) as normalized_name,
      i.id as item_id,
      i.product_name,
      i.category,
      r.id as receipt_id,
      r.date as receipt_date,
      r.store,
      row_number() over (
        partition by lower(regexp_replace(btrim(i.product_name), '\s+', ' ', 'g'))
        order by r.date desc, i.id desc
      ) as evidence_rank
    from public.items i
    join public.receipts r on r.id = i.receipt_id
  ),
  product_rows as (
    select
      lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) as normalized_name,
      p.id as product_id,
      p.name,
      p.category,
      p.store,
      p.store_product_code
    from public.products p
  ),
  names as (
    select normalized_name from item_rows
    union
    select normalized_name from product_rows
  )
  select
    n.normalized_name,
    coalesce((
      select jsonb_agg(distinct ir.product_name order by ir.product_name)
      from item_rows ir
      where ir.normalized_name = n.normalized_name
    ), '[]'::jsonb) as item_names,
    coalesce((
      select jsonb_agg(distinct pr.name order by pr.name)
      from product_rows pr
      where pr.normalized_name = n.normalized_name
    ), '[]'::jsonb) as product_names,
    coalesce((
      select jsonb_agg(distinct ir.category order by ir.category)
      from item_rows ir
      where ir.normalized_name = n.normalized_name
    ), '[]'::jsonb) as item_categories,
    coalesce((
      select jsonb_agg(distinct pr.category order by pr.category)
      from product_rows pr
      where pr.normalized_name = n.normalized_name
    ), '[]'::jsonb) as product_categories,
    coalesce((
      select jsonb_agg(distinct ir.store order by ir.store)
      from item_rows ir
      where ir.normalized_name = n.normalized_name
    ), '[]'::jsonb) as receipt_stores,
    coalesce((
      select jsonb_agg(distinct pr.store order by pr.store)
      from product_rows pr
      where pr.normalized_name = n.normalized_name
    ), '[]'::jsonb) as product_stores,
    (select count(*) from item_rows ir where ir.normalized_name = n.normalized_name) as item_count,
    (select count(*) from product_rows pr where pr.normalized_name = n.normalized_name) as product_count,
    (
      select jsonb_agg(jsonb_build_object(
        'item_id', ir.item_id,
        'receipt_id', ir.receipt_id,
        'receipt_date', ir.receipt_date,
        'store', ir.store
      ) order by ir.receipt_date desc, ir.item_id desc)
      from item_rows ir
      where ir.normalized_name = n.normalized_name
        and ir.evidence_rank <= 3
    ) as receipt_evidence,
    (
      select jsonb_agg(jsonb_build_object(
        'product_id', pr.product_id,
        'store', pr.store,
        'store_product_code', pr.store_product_code
      ) order by pr.store, pr.product_id)
      from product_rows pr
      where pr.normalized_name = n.normalized_name
    ) as product_evidence
  from names n
  order by n.normalized_name;
`;

const supabaseCommand =
  process.platform === 'win32'
    ? resolve(process.cwd(), 'node_modules/supabase/bin/supabase.exe')
    : 'npx';
const { stdout, stderr } = await execFile(
  supabaseCommand,
  process.platform === 'win32'
    ? ['db', 'query', '--linked', '--output', 'json', query]
    : ['supabase', 'db', 'query', '--linked', '--output', 'json', query],
  {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
  },
);

if (stderr.trim()) process.stderr.write(stderr);

const response = JSON.parse(stdout);
if (!Array.isArray(response.rows)) {
  throw new TypeError('Supabase CLI did not return a rows array. The inventory was not written.');
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: 'live Supabase via read-only supabase db query --linked',
      rows: response.rows,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Wrote ${response.rows.length} normalized names to ${outputPath}.`);
