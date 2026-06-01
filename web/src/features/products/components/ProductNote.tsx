import { marked } from 'marked';

/**
 * Render a product's free-text note as Markdown so users can add links, bold
 * names, bullet lists of variants, etc.
 */
export function ProductNote({ markdown }: { markdown: string }) {
  const html = marked.parse(markdown);
  return <div className="text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: html }} />;
}
