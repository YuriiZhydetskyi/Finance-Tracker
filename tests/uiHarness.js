/**
 * UI test harness — JSDOM + Alpine.js boot for page-level tests.
 *
 * What it does:
 *   1. Calls Web.doGet for the requested page → gets fully-rendered HTML
 *      (the HtmlService fake processes scriptlets).
 *   2. Strips the Alpine CDN <script> tag (JSDOM doesn't load externals).
 *   3. Builds a JSDOM with runScripts='dangerously' so the page's inline
 *      scripts (webapp.html bridge + page-specific Alpine factory) run.
 *   4. Injects a stubbed window.google.script.run that routes calls to
 *      the test's runServerStubs map.
 *   5. Seeds localStorage if asked.
 *   6. Evals the local Alpine source into the JSDOM window — Alpine
 *      processes x-data and triggers x-init.
 *   7. Awaits the 'alpine:initialized' event + a microtask flush so any
 *      pending init() promises (which often kick off runServer calls)
 *      resolve before tests assert.
 *
 * What it does NOT simulate:
 *   - File input picker semantics, URL.createObjectURL, real iframe
 *     postMessage. JSDOM is not a browser.
 *   - Apps Script Java-proxy quirks of HtmlTemplate.
 *
 * Usage:
 *   const { renderPage } = require('./uiHarness');
 *   const { window } = await renderPage({
 *     page: 'recent',
 *     runServerStubs: { listRecent: () => [...], whoAmI: () => 'me@x' },
 *   });
 *   assert.match(window.document.querySelector('h1').textContent, /Останні/);
 */

const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const { fakes, resetAllFakes, Storage, Web } = require('./bootstrap');

const ALPINE_SRC = fs.readFileSync(require.resolve('alpinejs/dist/cdn.min.js'), 'utf8');

const SHEETS = ['Receipts', 'Items', 'Products', 'Categories'];
const HEADERS = {
  Receipts: ['id', 'date', 'store', 'currency', 'total_orig', 'fx_rate_eur', 'total_eur', 'paid_by', 'photo_url', 'source', 'raw_ocr_json', 'note', 'created_at', 'updated_at'],
  Items: ['id', 'receipt_id', 'product_id', 'product_name', 'category', 'qty', 'unit_price_orig', 'total_orig', 'total_eur', 'consumed_by', 'note', 'wasted_qty', 'discount_orig', 'created_at', 'updated_at'],
  Products: ['id', 'name', 'category', 'unit', 'unit_size', 'notes', 'created_at', 'updated_at'],
  Categories: ['name', 'group'],
};

function setupBlankSheet() {
  resetAllFakes();
  Storage.resetCaches();
  const ss = fakes.SpreadsheetApp.openById('fake-sheet-id');
  for (const name of SHEETS) ss.createSheetWithHeaders(name, HEADERS[name]);
  return ss;
}

/**
 * Build a Proxy mimicking google.script.run's builder API:
 *   google.script.run.withSuccessHandler(cb).withFailureHandler(cb).fnName(args)
 *
 * Stubs map function names to either:
 *   - a synchronous value      → success callback receives it
 *   - a function               → invoked with args; return value passed to success
 *   - a function returning Promise → resolves/rejects accordingly
 *   - missing entry            → failure handler invoked with explicit error
 */
function makeRunProxy(stubs) {
  function builder(handlers) {
    return new Proxy({}, {
      get(_, fnName) {
        if (fnName === 'withSuccessHandler') {
          return cb => builder(Object.assign({}, handlers, { success: cb }));
        }
        if (fnName === 'withFailureHandler') {
          return cb => builder(Object.assign({}, handlers, { failure: cb }));
        }
        if (typeof fnName === 'symbol') return undefined;
        return function invokeStub(...args) {
          let promise;
          try {
            const stub = stubs[fnName];
            if (stub === undefined) {
              throw new Error(`runServer stub missing for "${fnName}"`);
            }
            const value = (typeof stub === 'function') ? stub(...args) : stub;
            promise = Promise.resolve(value);
          } catch (e) {
            promise = Promise.reject(e);
          }
          // google.script.run is asynchronous; mirror that with setTimeout(0).
          promise.then(
            v => setTimeout(() => handlers.success && handlers.success(v), 0),
            e => setTimeout(() => handlers.failure && handlers.failure(e), 0),
          );
        };
      },
    });
  }
  return builder({});
}

/**
 * @param {Object} opts
 * @param {string} opts.page - e.g. 'index', 'recent', 'photo', 'manual', 'edit'
 * @param {Object} [opts.queryParams]      - merged into doGet's e.parameter
 * @param {Object} [opts.runServerStubs]   - { whoAmI: () => '...', listRecent: () => [...], ... }
 * @param {string} [opts.userEmail]        - prepopulate localStorage
 * @param {boolean} [opts.silent]          - suppress JSDOM console output (default true)
 * @returns {Promise<{dom: JSDOM, window: Window, document: Document}>}
 */
async function renderPage(opts) {
  setupBlankSheet();

  const params = Object.assign({ page: opts.page }, opts.queryParams || {});
  let html = Web.doGet({ parameter: params }).getContent();

  // Strip the Alpine CDN <script>. We inject the local copy after construction
  // so we control the timing relative to google.script.run wiring.
  html = html.replace(/<script\b[^>]*alpinejs[^>]*><\/script>/i, '');

  const virtualConsole = new VirtualConsole();
  if (opts.silent !== false) {
    // Suppress JSDOM's "Could not parse CSS stylesheet" noise from any inline
    // styles we don't perfectly support; surface real errors via a 'jsdomError' listener if needed.
    virtualConsole.on('jsdomError', () => {});
  } else {
    virtualConsole.sendTo(console);
  }

  const dom = new JSDOM(html, {
    url: 'https://script.google.com/macros/s/fake-deployment-id/exec',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const win = dom.window;

  // Stub identity localStorage if asked.
  if (typeof opts.userEmail === 'string' && opts.userEmail) {
    win.localStorage.setItem('financeTracker.userEmail', opts.userEmail);
  }

  // Inject google.script.run AFTER page's webapp.html script ran (which
  // doesn't reference google yet), but BEFORE Alpine boots (since x-init
  // calls runServer).
  win.google = { script: { run: makeRunProxy(opts.runServerStubs || {}) } };

  // Eval Alpine into the JSDOM window. Alpine reads the `document` from its
  // own scope, which here is JSDOM's window. It auto-starts on
  // DOMContentLoaded — by now JSDOM's parser has fired that, so Alpine
  // immediately processes x-data.
  const initPromise = new Promise(resolve => {
    win.document.addEventListener('alpine:initialized', () => resolve(), { once: true });
  });
  win.eval(ALPINE_SRC);

  // Race a 2s timeout so a never-firing event doesn't hang the suite.
  await Promise.race([
    initPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Alpine did not initialize within 2s')), 2000)),
  ]);

  // Flush microtasks: x-init handlers often call async runServer, which
  // schedules setTimeout(0) callbacks. Give them a chance to settle.
  await flushAsync(win);

  return { dom, window: win, document: win.document };
}

/** Wait until pending setTimeout(0) and microtasks have all run. */
async function flushAsync(win) {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => win.setTimeout(r, 0));
  }
}

module.exports = { renderPage, setupBlankSheet, flushAsync, makeRunProxy };
