/**
 * FakeHtmlService — real Apps Script scriptlet evaluator (Phase 3.5).
 *
 * The previous version was a no-op stub; it never expanded scriptlets, never
 * resolved <?!= include(...) ?>, and never failed on malformed templates.
 * Tests passed against a synthetic universe — and so we deployed two bugs:
 *   1. createHtmlOutputFromFile leaving <?!= ... ?> as literal text.
 *   2. recursive template eval breaking on Apps Script's Java-proxy quirks.
 *
 * What this fake does:
 *   - createTemplateFromFile(name) reads src/<name>.html, returns a template
 *     object whose evaluate() processes scriptlets (<? ?>, <?= ?>, <?!= ?>)
 *     against the template's own properties (so tpl.foo='X' substitutes
 *     into <?= foo ?>).
 *   - createHtmlOutputFromFile(name) returns the file's RAW content (no
 *     scriptlet eval) — mirroring the real Apps Script behavior. THE
 *     ASYMMETRY IS THE POINT — Web.include relies on this to inline shared
 *     fragments without re-entering the evaluator.
 *
 * What this fake DOES NOT simulate (accepted ceiling):
 *   - Java-proxy semantics of HtmlTemplate. Setting custom properties on the
 *     real proxy interacts with its prototype chain in ways no JS object
 *     reproduces. To catch those bugs, run smokeWebRoutes inside live
 *     Apps Script (see Sub-block C / docs/setup.md).
 */

const fs = require('node:fs');
const path = require('node:path');

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');

// ============================================================
// Scriptlet evaluator
// ============================================================

const SCRIPTLET_RE = /<\?(!?=)?\s*([\s\S]*?)\s*\?>/g;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function htmlEscape(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

function loadFile(name) {
  const filePath = path.join(SRC_ROOT, `${name}.html`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No HTML file named "${name}" found.`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Render a template source to HTML.
 *
 * @param {string} source - raw HTML with optional scriptlets.
 * @param {Object} props  - own properties on the HtmlTemplate (visible inside
 *                          scriptlets as if local variables).
 * @returns {string} rendered HTML
 */
function renderSource(source, props) {
  // include() inside scriptlets defers to whichever global include() the
  // production code defines — same path the real Apps Script template would
  // take. tests/bootstrap.js sets globalThis.include via Web's top-level
  // wrapper.
  function includeFn(name) {
    if (typeof globalThis.include === 'function') return globalThis.include(name);
    // Fallback: mirror Web.include's createHtmlOutputFromFile semantics —
    // raw file content, no nested eval. This keeps the fake usable even
    // before bootstrap.js has wired the global wrapper.
    return loadFile(`ui/${name}`);
  }

  let result = '';
  let lastIndex = 0;
  SCRIPTLET_RE.lastIndex = 0;
  let match;
  while ((match = SCRIPTLET_RE.exec(source)) !== null) {
    result += source.slice(lastIndex, match.index);
    const tag = match[1]; // '!=' raw, '=' escaped, undefined = code-only
    const body = match[2];
    result += runScriptlet(tag, body, props, includeFn);
    lastIndex = SCRIPTLET_RE.lastIndex;
  }
  result += source.slice(lastIndex);
  return result;
}

function runScriptlet(tag, body, props, includeFn) {
  // `with(__props__)` puts template props in scope as if local variables.
  // new Function() always creates non-strict functions, so `with` works
  // regardless of the calling context's strict-mode setting.
  let fnBody;
  if (tag === '!=' || tag === '=') {
    fnBody = `with(__props__){return (${body})}`;
  } else {
    fnBody = `with(__props__){${body}}`;
  }
  let fn;
  try {
    fn = new Function('include', '__props__', fnBody);
  } catch (e) {
    throw new Error(`Scriptlet syntax error in <?${tag || ''} ${body} ?>: ${e.message}`);
  }
  let value;
  try {
    value = fn(includeFn, props);
  } catch (e) {
    throw new Error(`Scriptlet failed <?${tag || ''} ${body} ?>: ${e.message}`);
  }
  if (tag === '=') return htmlEscape(value);
  if (tag === '!=') return value === undefined || value === null ? '' : String(value);
  return ''; // code-only block; no output
}

// ============================================================
// HtmlOutput-like wrapper
// ============================================================

function makeOutput(content) {
  const out = {
    _content: content,
    _title: '',
    _meta: [],
    _xframe: null,
    getContent() { return out._content; },
    setTitle(t) { out._title = t; return out; },
    addMetaTag(name, value) { out._meta.push({ name, value }); return out; },
    setXFrameOptionsMode(mode) { out._xframe = mode; return out; },
  };
  return out;
}

// ============================================================
// Public fake
// ============================================================

function makeFakeHtmlService() {
  function makeTemplate(name) {
    const tpl = { _filename: name };
    tpl.evaluate = function() {
      // Collect own props (skip framework keys + any methods).
      const props = {};
      for (const key of Object.keys(tpl)) {
        if (key === '_filename' || key === 'evaluate') continue;
        if (typeof tpl[key] === 'function') continue;
        props[key] = tpl[key];
      }
      const source = loadFile(name);
      const rendered = renderSource(source, props);
      return makeOutput(rendered);
    };
    return tpl;
  }

  return {
    XFrameOptionsMode: {
      DEFAULT: 'DEFAULT',
      ALLOWALL: 'ALLOWALL',
      SAMEORIGIN: 'SAMEORIGIN',
    },

    /** Returns an HtmlTemplate-like object that processes scriptlets on evaluate(). */
    createTemplateFromFile(name) {
      return makeTemplate(name);
    },

    /** Returns RAW file content. No scriptlet evaluation — matches Apps Script. */
    createHtmlOutputFromFile(name) {
      return makeOutput(loadFile(name));
    },

    /** Build an HtmlOutput directly from a string (used for the denied page). */
    createHtmlOutput(content) {
      return makeOutput(content || '');
    },

    _reset() { /* stateless */ },
  };
}

module.exports = { makeFakeHtmlService };
