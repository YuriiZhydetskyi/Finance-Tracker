import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PDF.js loads codecs/fonts by their original filenames. Ship the pinned
// package's assets on our own origin, including its third-party licenses.
const require = createRequire(new URL('../web/package.json', import.meta.url));
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const target = fileURLToPath(new URL('../web/public/pdfjs/', import.meta.url));
await mkdir(target, { recursive: true });
for (const folder of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  await cp(join(source, folder), join(target, folder), { recursive: true });
}
