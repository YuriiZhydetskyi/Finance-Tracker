// Single source of truth for "is this a PDF" by file path or name. Storage
// paths/filenames carry the real extension; the blob's MIME type can come back
// as application/octet-stream from a signed-URL fetch, so we key off the path.
export function isPdfPath(pathOrName: string): boolean {
  return /\.pdf$/i.test(pathOrName);
}
