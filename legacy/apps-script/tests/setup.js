/**
 * Apps Script global stubs for Node-side unit tests.
 *
 * Domain.js calls Utilities.formatDate() inside time helpers and reads
 * Config.* constants in rounding helpers and validators. Stubs below give
 * those identifiers sensible Node-friendly behavior so the module loads and
 * its pure logic can be tested without an Apps Script runtime.
 */

global.Utilities = {
  /**
   * Mimic Apps Script's Utilities.formatDate for the two patterns we use:
   *   - 'yyyy-MM-dd'                  → 'YYYY-MM-DD'
   *   - "yyyy-MM-dd'T'HH:mm:ssXXX"    → 'YYYY-MM-DDTHH:MM:SS+00:00'
   * Other patterns fall through to ISO string.
   */
  formatDate(date, _tz, fmt) {
    const iso = date.toISOString();          // 2026-05-04T14:30:00.123Z
    if (fmt === 'yyyy-MM-dd') return iso.slice(0, 10);
    return iso.replace(/\.\d{3}Z$/, '+00:00');
  },
  /**
   * base64-encode raw bytes. Apps Script accepts Uint8Array or number[]; in
   * Node we accept either and route through Buffer.
   */
  base64Encode(bytes) {
    if (typeof bytes === 'string') return Buffer.from(bytes).toString('base64');
    return Buffer.from(bytes).toString('base64');
  },

  /**
   * base64-decode to a number[]-like byte array. Apps Script returns
   * Byte[] (a Java byte array exposed as number[] in JS); we mirror that
   * with a JS array so tests don't trip on Buffer-vs-array identity.
   */
  base64Decode(str) {
    return Array.from(Buffer.from(str, 'base64'));
  },

  /**
   * newBlob(data, mimeType?, name?) — Apps Script returns a Blob with
   * getBytes/getName/getContentType/getDataAsString.
   */
  newBlob(data, mimeType, name) {
    const bytes = (typeof data === 'string')
      ? Array.from(Buffer.from(data))
      : Array.from(data);
    return {
      _bytes: bytes,
      _mimeType: mimeType || 'application/octet-stream',
      _name: name || 'noname',
      getBytes() { return this._bytes; },
      getName() { return this._name; },
      getContentType() { return this._mimeType; },
      getDataAsString() { return Buffer.from(this._bytes).toString('utf-8'); },
      setName(n) { this._name = n; return this; },
    };
  },
};

global.Config = {
  TIMEZONE: 'UTC',
  BASE_CURRENCY: 'EUR',
  MONEY_DECIMALS: 2,
  FX_RATE_DECIMALS: 6,
  QTY_DECIMALS: 3,
};
