/**
 * FakeHtmlService.
 *
 * Minimal in-memory implementation for Web.doGet routing tests. We don't
 * actually render templates here — `evaluate()` returns an HtmlOutput-like
 * object whose getContent() reports the requested filename, which is
 * sufficient for "doGet picked the right page" assertions.
 *
 * For richer template-evaluation testing in the future, point evaluate()
 * at a real renderer. Until then, YAGNI.
 */

function makeFakeHtmlService() {
  function makeOutput(filename, content) {
    const out = {
      _filename: filename,
      _title: '',
      _meta: [],
      _xframe: null,
      getContent() { return content; },
      setTitle(t) { out._title = t; return out; },
      addMetaTag(name, value) { out._meta.push({ name, value }); return out; },
      setXFrameOptionsMode(mode) { out._xframe = mode; return out; },
    };
    return out;
  }

  return {
    XFrameOptionsMode: {
      DEFAULT: 'DEFAULT',
      ALLOWALL: 'ALLOWALL',
      SAMEORIGIN: 'SAMEORIGIN',
    },

    /** Returns an HtmlTemplate-like object whose evaluate() reports the file. */
    createTemplateFromFile(name) {
      return {
        _filename: name,
        evaluate() {
          return makeOutput(name, `<!-- template: ${name} -->`);
        },
      };
    },

    /** Returns an HtmlOutput-like object directly (used by Web.include). */
    createHtmlOutputFromFile(name) {
      return makeOutput(name, `<!-- include: ${name} -->`);
    },

    _reset() { /* stateless */ },
  };
}

module.exports = { makeFakeHtmlService };
