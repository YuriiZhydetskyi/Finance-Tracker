/**
 * FakeScriptApp.
 *
 * Implements the subset used by Web.js: ScriptApp.getService().getUrl().
 *
 * Test helpers:
 *   - _setServiceUrl(url) — override the URL returned by getUrl()
 *   - _reset()            — restore the default fake URL
 */

const DEFAULT_URL = 'https://script.google.com/macros/s/fake-deployment-id/exec';

let _serviceUrl = DEFAULT_URL;

function makeFakeScriptApp() {
  return {
    getService() {
      return { getUrl: () => _serviceUrl };
    },

    // Test helpers
    _setServiceUrl(url) { _serviceUrl = url; },
    _reset() { _serviceUrl = DEFAULT_URL; },
  };
}

module.exports = { makeFakeScriptApp, DEFAULT_URL };
