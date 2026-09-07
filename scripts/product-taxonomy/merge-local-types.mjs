import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import prettier from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(root, 'web/src/shared/types/database.types.ts');
const generated = resolve(root, '.cache/taxonomy-typegen/database.local.types.ts');
const currentText = await readFile(target, 'utf8');
const generatedText = await readFile(generated, 'utf8');

function parseDatabase(text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error(`Invalid generated TypeScript: ${path}`);
  const database = source.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'Database',
  );
  if (!database || !ts.isTypeLiteralNode(database.type))
    throw new Error(`Missing Database type: ${path}`);
  return { source, database: database.type };
}

function member(parent, name) {
  const property = parent.members.find(
    (entry) => entry.name?.getText().replaceAll('"', '').replaceAll("'", '') === name,
  );
  if (!property || !ts.isPropertySignature(property))
    throw new Error(`Missing schema member: ${name}`);
  return property;
}

const current = parseDatabase(currentText, target);
const next = parseDatabase(generatedText, generated);
const currentPublic = member(current.database, 'public').type;
const generatedPublic = member(next.database, 'public').type;
const edits = [];

for (const [section, names] of Object.entries({
  Tables: ['categories', 'items', 'product_families', 'product_variants', 'products'],
  Functions: ['normalize_product_search', 'search_waste_items'],
})) {
  const currentSection = member(currentPublic, section).type;
  const generatedSection = member(generatedPublic, section).type;
  for (const name of names) {
    const replacement = member(generatedSection, name);
    const existing = currentSection.members.find((node) => node.name?.getText() === name);
    if (existing && section === 'Tables') {
      // Refuse to erase columns when the dependency slice is missing a migration.
      for (const shape of ['Row', 'Insert', 'Update']) {
        const oldKeys = member(existing.type, shape).type.members.map((node) =>
          node.name.getText(),
        );
        const newKeys = new Set(
          member(replacement.type, shape).type.members.map((node) => node.name.getText()),
        );
        for (const key of oldKeys) {
          if (!newKeys.has(key))
            throw new Error(
              `Introspection would remove ${name}.${shape}.${key}; load its migration first.`,
            );
        }
      }
    }
    const replacementText = `${replacement.getText(next.source)};`;
    if (existing) {
      edits.push({
        start: existing.getStart(current.source),
        end: existing.end,
        text: replacementText,
      });
    } else {
      const later = currentSection.members.find(
        (node) => node.name?.getText().localeCompare(name) > 0,
      );
      const at = later ? later.getStart(current.source) : currentSection.end - 1;
      edits.push({ start: at, end: at, text: `${replacementText}\n` });
    }
  }
}

let merged = currentText;
for (const edit of edits.sort(
  (a, b) => b.start - a.start || b.end - a.end || b.text.localeCompare(a.text),
)) {
  merged = merged.slice(0, edit.start) + edit.text + merged.slice(edit.end);
}
const options = await prettier.resolveConfig(target);
await writeFile(target, await prettier.format(merged, { ...options, filepath: target }), 'utf8');
console.log(
  'Merged introspected taxonomy tables and RPCs; unrelated generated definitions preserved.',
);
