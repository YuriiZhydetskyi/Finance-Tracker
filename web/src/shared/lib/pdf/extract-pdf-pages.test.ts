import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPdfPages } from './extract-pdf-pages';

/** A PDF whose page N has the text "page N" and the size 200 + N by 300. */
async function samplePdf(pageCount: number, options: { rotatePage?: number } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pageCount; n += 1) {
    const page = doc.addPage([200 + n, 300]);
    page.drawText(`page ${String(n)}`, { x: 20, y: 150, size: 18, font });
    if (n === options.rotatePage) page.setRotation(degrees(90));
  }
  return doc.save();
}

async function pageSizes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getSize().width);
}

describe('extractPdfPages', () => {
  it('keeps only the requested pages, in the requested order', async () => {
    const source = await samplePdf(4);

    const cut = await extractPdfPages(source, [3, 1]);

    expect(await pageSizes(cut)).toEqual([203, 201]);
  });

  it('returns a valid PDF', async () => {
    const cut = await extractPdfPages(await samplePdf(3), [2]);

    expect(new TextDecoder().decode(cut.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(cut)).getPageCount()).toBe(1);
  });

  it('ignores a page listed twice', async () => {
    const cut = await extractPdfPages(await samplePdf(3), [2, 2]);

    expect(await pageSizes(cut)).toEqual([202]);
  });

  it("preserves a page's rotation", async () => {
    const cut = await extractPdfPages(await samplePdf(3, { rotatePage: 2 }), [2]);

    const [page] = (await PDFDocument.load(cut)).getPages();
    expect(page?.getRotation().angle).toBe(90);
  });

  it('is deterministic, so the same pages always hash the same', async () => {
    const source = await samplePdf(3);

    const first = await extractPdfPages(source, [1, 2]);
    const second = await extractPdfPages(source, [1, 2]);

    expect(second).toEqual(first);
  });

  it('does not change the source bytes', async () => {
    const source = await samplePdf(3);
    const before = source.slice();

    await extractPdfPages(source, [2]);

    expect(source).toEqual(before);
  });

  it('rejects a page outside the document', async () => {
    const source = await samplePdf(2);

    await expect(extractPdfPages(source, [3])).rejects.toThrow('поза межами');
    await expect(extractPdfPages(source, [0])).rejects.toThrow('поза межами');
    await expect(extractPdfPages(source, [1.5])).rejects.toThrow('поза межами');
  });

  it('rejects an empty page list', async () => {
    await expect(extractPdfPages(await samplePdf(1), [])).rejects.toThrow('жодної сторінки');
  });

  it('turns an unreadable file into a clear message', async () => {
    const error = await extractPdfPages(new TextEncoder().encode('not a pdf'), [1]).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Не вдалося вирізати сторінку чека');
  });
});
