// Email HTML becomes plain text for the receipt model. The input is untrusted
// and the function has a 2 s CPU budget, so removal of comments and
// script/style blocks is a forward scan and every remaining pattern is linear.
const MAX_HTML_CHARS = 500_000;
const SKIPPED_ELEMENTS = /<(script|style|head|title)\b/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  copy: '©',
  reg: '®',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  times: '×',
};

export function htmlToText(html: string): string {
  const text = removeSkippedElements(removeComments(html.slice(0, MAX_HTML_CHARS)))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:td|th)\s*>/gi, ' | ')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|table|section|header|footer|blockquote)\s*>/gi, '\n')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/</g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) =>
      line
        .replace(/[\s ​-‍﻿]+/g, ' ')
        .replace(/(?: ?\| ?)+/g, ' | ')
        .replace(/^ \| | \| $/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

function removeComments(html: string): string {
  let result = '';
  let position = 0;
  while (position < html.length) {
    const start = html.indexOf('<!--', position);
    if (start === -1) return result + html.slice(position);
    result += html.slice(position, start) + ' ';
    const end = html.indexOf('-->', start + 4);
    if (end === -1) return result;
    position = end + 3;
  }
  return result;
}

function removeSkippedElements(html: string): string {
  let result = '';
  let position = 0;
  SKIPPED_ELEMENTS.lastIndex = 0;
  for (let match = SKIPPED_ELEMENTS.exec(html); match; match = SKIPPED_ELEMENTS.exec(html)) {
    result += html.slice(position, match.index) + ' ';
    const closing = new RegExp(`</${match[1] ?? ''}\\s*>`, 'gi');
    closing.lastIndex = match.index + match[0].length;
    const end = closing.exec(html);
    if (!end) return result;
    position = end.index + end[0].length;
    SKIPPED_ELEMENTS.lastIndex = position;
  }
  return result + html.slice(position);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (entity, body: string) => {
    if (body.startsWith('#')) {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ' ';
    }
    return NAMED_ENTITIES[body] ?? entity;
  });
}
