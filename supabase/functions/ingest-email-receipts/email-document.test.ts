import { describe, expect, it } from 'vitest';
import { formatBerlinTime, parseEmail, senderAuthentication } from './email-document.ts';

const GMAIL_PASS = [
  'Authentication-Results: mx.google.com;',
  '       dkim=pass header.i=@app.edeka.de header.s=s1 header.b=abc;',
  '       spf=pass smtp.mailfrom=noreply@app.edeka.de;',
  '       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=app.edeka.de',
].join('\r\n');

const PDF_BASE64 = btoa('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');

function rawEmail(headers: string, body: string): Uint8Array {
  return new TextEncoder().encode(`${headers}\r\n\r\n${body}`);
}

describe('parseEmail', () => {
  it('returns PDF attachments as documents and ignores the body', async () => {
    const email = await parseEmail(
      rawEmail(
        [
          GMAIL_PASS,
          'From: EDEKA <noreply@app.edeka.de>',
          'Subject: Vielen Dank für Ihren Einkauf',
          'Date: Mon, 26 Oct 2026 13:05:00 +0000',
          'MIME-Version: 1.0',
          'Content-Type: multipart/mixed; boundary="b1"',
        ].join('\r\n'),
        [
          '--b1',
          'Content-Type: text/plain; charset=utf-8',
          '',
          'Ihr Kassenbon im Anhang.',
          '--b1',
          'Content-Type: application/pdf; name="eBon 26.10.pdf"',
          'Content-Disposition: attachment; filename="eBon 26.10.pdf"',
          'Content-Transfer-Encoding: base64',
          '',
          PDF_BASE64,
          '--b1',
          'Content-Type: application/octet-stream; name="logo.png"',
          'Content-Disposition: attachment; filename="logo.png"',
          'Content-Transfer-Encoding: base64',
          '',
          btoa('not a pdf'),
          '--b1--',
        ].join('\r\n'),
      ),
    );

    expect(email.senderAddress).toBe('noreply@app.edeka.de');
    expect(email.authentication).toBe('pass');
    expect(email.documents).toHaveLength(1);
    expect(email.documents[0]).toMatchObject({
      filename: 'eBon 26.10.pdf',
      mimeType: 'application/pdf',
    });
    expect(new TextDecoder().decode(email.documents[0]?.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('turns an HTML-only order email into a text document with an importer header', async () => {
    const email = await parseEmail(
      rawEmail(
        [
          GMAIL_PASS.replaceAll('app.edeka.de', 'amazon.de'),
          'From: "Amazon.de" <bestellbestaetigung@amazon.de>',
          'Subject: Bestellt: Bands',
          'Date: Mon, 26 Oct 2026 13:05:00 +0000',
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=utf-8',
        ].join('\r\n'),
        '<html><head><style>p{}</style></head><body><table><tr><td>Bands</td><td>Menge: 2</td><td>EUR 15,98</td></tr></table><p>Gesamtbetrag &euro; 15,98</p></body></html>',
      ),
    );

    expect(email.documents).toHaveLength(1);
    const [document] = email.documents;
    expect(document?.mimeType).toBe('text/plain');
    expect(document?.filename).toBe('Bestellt Bands.txt');
    expect(new TextDecoder().decode(document?.bytes)).toBe(
      [
        'From: Amazon.de <bestellbestaetigung@amazon.de>',
        'Date: 2026-10-26 14:05 (Europe/Berlin)',
        'Subject: Bestellt: Bands',
        '',
        'Bands | Menge: 2 | EUR 15,98',
        'Gesamtbetrag € 15,98',
      ].join('\n'),
    );
  });

  it('returns no documents for an email without a PDF or a body', async () => {
    const email = await parseEmail(
      rawEmail(
        [
          GMAIL_PASS,
          'From: noreply@app.edeka.de',
          'Subject: Leer',
          'Content-Type: text/plain',
        ].join('\r\n'),
        '',
      ),
    );
    expect(email.documents).toEqual([]);
  });
});

describe('senderAuthentication', () => {
  const header = (value: string) => ({
    key: 'authentication-results',
    originalKey: 'Authentication-Results',
    value,
  });

  it('trusts only the first verdict from Gmail, not one added by the sender', () => {
    expect(
      senderAuthentication(
        [
          header(
            'mx.google.com; dkim=fail; spf=softfail; dmarc=fail (p=REJECT) header.from=amazon.de',
          ),
          header('mx.google.com; dkim=pass header.i=@amazon.de; dmarc=pass header.from=amazon.de'),
        ],
        'bestellbestaetigung@amazon.de',
      ),
    ).toBe('fail');
  });

  it('accepts a DKIM pass aligned with the From domain when DMARC is absent', () => {
    expect(
      senderAuthentication(
        [header('mx.google.com; dkim=pass header.i=@edeka.de header.s=s1; spf=pass')],
        'noreply@app.edeka.de',
      ),
    ).toBe('pass');
  });

  it('does not accept a DKIM pass of an unrelated domain', () => {
    expect(
      senderAuthentication(
        [header('mx.google.com; dkim=pass header.i=@attacker.example; spf=pass')],
        'noreply@app.edeka.de',
      ),
    ).toBe('unknown');
    expect(senderAuthentication([], 'noreply@app.edeka.de')).toBe('unknown');
  });
});

describe('formatBerlinTime', () => {
  it('converts to Berlin local time across the DST switch', () => {
    expect(formatBerlinTime(new Date('2026-10-24T13:05:00Z'))).toBe('2026-10-24 15:05');
    expect(formatBerlinTime(new Date('2026-10-26T13:05:00Z'))).toBe('2026-10-26 14:05');
  });
});
