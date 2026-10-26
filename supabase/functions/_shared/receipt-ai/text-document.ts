// Email bodies are stored as UTF-8 text files and travel through the import
// queue base64-encoded, exactly like PDFs and photos.
export const TEXT_DOCUMENT_MIME = 'text/plain';

export function isTextDocument(mimeType: string): boolean {
  return mimeType === TEXT_DOCUMENT_MIME;
}

export function decodeTextDocument(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
