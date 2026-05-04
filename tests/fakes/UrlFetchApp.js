/**
 * Stub-based FakeUrlFetchApp.
 *
 * Tests register URL → response mappings via setStub(url, { content, code }).
 * fetch() / fetchAll() return matching stubs or throw "no stub registered".
 */

class FakeHTTPResponse {
  constructor({ content = '', code = 200 } = {}) {
    this._content = content;
    this._code = code;
  }
  getContentText() { return this._content; }
  getResponseCode() { return this._code; }
}

const stubs = new Map();

function makeFakeUrlFetchApp() {
  return {
    fetch(url, _options) {
      const stub = stubs.get(url);
      if (!stub) throw new Error(`FakeUrlFetchApp: no stub registered for URL: ${url}`);
      return new FakeHTTPResponse(stub);
    },

    fetchAll(requests) {
      return requests.map(req => {
        const stub = stubs.get(req.url);
        if (!stub) {
          // Mimic Apps Script behavior: return a response with the error code,
          // not throw. fetchAll lets caller handle per-request failures.
          return new FakeHTTPResponse({ code: 404, content: 'no stub' });
        }
        return new FakeHTTPResponse(stub);
      });
    },

    // Test helpers (not part of real Apps Script API).
    _setStub(url, response) { stubs.set(url, response); },
    _reset() { stubs.clear(); },
  };
}

module.exports = { makeFakeUrlFetchApp, FakeHTTPResponse };
