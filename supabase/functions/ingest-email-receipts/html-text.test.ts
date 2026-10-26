import { describe, expect, it } from 'vitest';
import { htmlToText } from './html-text.ts';

describe('htmlToText', () => {
  it('keeps table cells on one line separated by pipes', () => {
    expect(
      htmlToText(
        '<table><tr><td> Avocado </td><td></td><td>2,55&nbsp;€</td></tr><tr><td>Brot</td><td>1,99</td></tr></table>',
      ),
    ).toBe('Avocado | 2,55 €\nBrot | 1,99');
  });

  it('drops scripts, styles and comments and decodes entities', () => {
    expect(
      htmlToText(
        '<style>.x{color:red}</style><script>alert(1)</script><!-- hidden --><p>K&auml;se &amp; Brot &#8364; 3,50 &#x2013; ok</p>',
      ),
    ).toBe('Käse & Brot € 3,50 – ok');
  });

  it('leaves unknown entities untouched', () => {
    expect(htmlToText('<p>&unknownentity; 1,00</p>')).toBe('&unknownentity; 1,00');
  });
});
