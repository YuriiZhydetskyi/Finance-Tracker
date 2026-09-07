import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireTool = createRequire(resolve(root, '.cache/taxonomy-typegen/package.json'));
const { Client } = requireTool('pg');
const { introspect, sortGeneratorMetadata, generateTypescript } = await import(
  pathToFileURL(requireTool.resolve('@supabase/postgrest-typegen')).href
);
const databaseUrl = new URL(process.argv[2]);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('This helper only introspects the disposable localhost database.');
}
const client = new Client({ connectionString: databaseUrl.href });
await client.connect();
try {
  const metadata = sortGeneratorMetadata(await introspect(client, { includedSchemas: ['public'] }));
  const output = await generateTypescript(metadata, {
    detectOneToOneRelationships: true,
    postgrestVersion: '14.5',
    defaultSchema: 'public',
  });
  const outputPath = resolve(root, '.cache/taxonomy-typegen/database.local.types.ts');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
  console.log(
    `Generated dependency-slice types from actual PostgreSQL introspection: ${outputPath}`,
  );
} finally {
  await client.end();
}
