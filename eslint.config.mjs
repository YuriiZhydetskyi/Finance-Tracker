import js from '@eslint/js';
import globals from 'globals';

/**
 * Apps Script V8 runtime globals.
 *
 * The `globals` npm package does not ship a `googleappsscript` preset
 * (despite many guides claiming otherwise), so we list the services we use
 * — and a few we don't yet but might soon — explicitly.
 */
const APPS_SCRIPT_GLOBALS = {
  // Spreadsheet & Drive
  SpreadsheetApp: 'readonly',
  DriveApp: 'readonly',

  // Web / HTTP / UI
  UrlFetchApp: 'readonly',
  HtmlService: 'readonly',
  ContentService: 'readonly',

  // System & utilities
  Utilities: 'readonly',
  Logger: 'readonly',
  console: 'readonly',
  Session: 'readonly',
  ScriptApp: 'readonly',
  PropertiesService: 'readonly',
  LockService: 'readonly',
  CacheService: 'readonly',
  XmlService: 'readonly',
  MimeType: 'readonly',

  // Mail / Calendar / Docs (not used yet, but cheap to declare)
  MailApp: 'readonly',
  GmailApp: 'readonly',
  CalendarApp: 'readonly',
  DocumentApp: 'readonly',

  // Container-bound / misc
  Browser: 'readonly',
};

/**
 * Project namespaces. Apps Script shares one global scope across all script
 * files, so each `const Module = {...}` in src/*.js is visible in every other
 * file. ESLint cannot infer that — we declare them here.
 *
 * 'writable' (not 'readonly') is required: each module declares itself via
 * `const`, which from ESLint's perspective is a redeclaration of the global.
 * 'writable' permits that without disabling no-redeclare globally.
 */
const PROJECT_GLOBALS = {
  Config: 'writable',
  Domain: 'writable',
  Storage: 'writable',
  Fx: 'writable',
  Smoke: 'writable',

  // Phase 2 placeholders — declared early to avoid future config churn
  AiClient: 'writable',
  Gemini: 'writable',
  OpenAi: 'writable',
  Anthropic: 'writable',
};

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...APPS_SCRIPT_GLOBALS,
        ...PROJECT_GLOBALS,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Disabled: in Apps Script every script file shares one global scope, so
      // each module is declared via `const Module = {...}` AND simultaneously
      // listed in `globals` above (so cross-file references don't trip
      // no-undef). That combination always trips no-redeclare regardless of
      // 'writable' status. Real redeclares (`var x; var x;`) are caught by
      // ES6 strict-mode SyntaxError and our no-`var` discipline.
      'no-redeclare': 'off',
    },
  },

  // Test files: Node CommonJS, no Apps Script globals.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
