import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// PDF.js loads codecs/fonts by their original filenames. Ship the pinned
// package's assets on our own origin, including its third-party licenses.
const webDir = join(import.meta.dirname, '..', 'web');
const require = createRequire(join(webDir, 'package.json'));
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const target = join(webDir, 'public', 'pdfjs');
await mkdir(target, { recursive: true });
for (const folder of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  await cp(join(source, folder), join(target, folder), { recursive: true });
}
