/**
 * Cuts the given pages (1-based, in the order listed) out of a PDF into a new,
 * self-contained PDF. Pages are copied, not rasterised, so the text and scan
 * quality the receipt parser sees is the original.
 *
 * The output is deterministic: no creation date or producer is stamped, so the same
 * pages of the same file always give the same bytes (and the same SHA-256, which the
 * import queue uses to recognise a document it already has).
 */
export async function extractPdfPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const unique = [...new Set(pages)];
  if (unique.length === 0) throw new Error('Не вказано жодної сторінки для вирізання.');

  // pdf-lib is only needed once a receipt page has to be cut out.
  const { PDFDocument } = await import('pdf-lib');
  let source: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new Error(
      'Не вдалося вирізати сторінку чека з PDF (файл зашифрований або пошкоджений).',
      { cause: error },
    );
  }
  const total = source.getPageCount();
  if (unique.some((page) => !Number.isInteger(page) || page < 1 || page > total)) {
    throw new Error('Номер сторінки поза межами PDF.');
  }

  const target = await PDFDocument.create({ updateMetadata: false });
  const copied = await target.copyPages(
    source,
    unique.map((page) => page - 1),
  );
  for (const page of copied) target.addPage(page);
  return target.save({ useObjectStreams: false });
}
