/**
 * Integration test bootstrap: installs Apps Script fakes + project namespaces.
 *
 * In Apps Script, all script files share one global scope. In Node, each file
 * is a CommonJS module. To bridge, we explicitly set src/ module exports onto
 * global so that cross-module references like `Domain.foo()` inside Storage.js
 * resolve.
 *
 * Use from integration tests instead of `./setup`:
 *   const { fakes, resetAllFakes, Domain, Storage } = require('./bootstrap');
 */

require('./setup');

const { installAllFakes, resetAllFakes } = require('./fakes');
const fakes = installAllFakes();

// Logger stub — Apps Script's `Logger.log()` writes to the Executions panel.
// Tests don't need to assert on log output, but cross-module code (AiClient
// fallback path, etc.) calls Logger.log unconditionally, so install a no-op.
global.Logger = { log() {} };

// PropertiesService stub for Config getters.
global.PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(key) {
        const stubs = {
          SHEET_ID: 'fake-sheet-id',
          DRIVE_FOLDER_ID: 'fake-drive-folder',
          GEMINI_API_KEY: 'fake-gemini-key',
          ANTHROPIC_API_KEY: 'fake-anthropic-key',
        };
        return Object.prototype.hasOwnProperty.call(stubs, key) ? stubs[key] : null;
      },
    };
  },
};

// Load project modules. Order matters: each may reference earlier ones.
const { Config } = require('../src/Config');
global.Config = Config;

const { Domain } = require('../src/Domain');
global.Domain = Domain;

const { Storage } = require('../src/Storage');
global.Storage = Storage;

const { Fx } = require('../src/Fx');
global.Fx = Fx;

const { Gemini } = require('../src/Gemini');
global.Gemini = Gemini;

const { OpenAi } = require('../src/OpenAi');
global.OpenAi = OpenAi;

const { Anthropic } = require('../src/Anthropic');
global.Anthropic = Anthropic;

const { AiClient } = require('../src/AiClient');
global.AiClient = AiClient;

const { Web } = require('../src/Web');
global.Web = Web;

// Apps Script puts top-level `function include(name) { ... }` (defined in
// src/Web.js) on the global scope. Node's CommonJS module loader does not.
// Mirror it here so HtmlService scriptlets `<?!= include('shared/...') ?>`
// resolve through Web.include the same way they do in production.
global.include = name => Web.include(name);

module.exports = { fakes, resetAllFakes, Config, Domain, Storage, Fx, Gemini, OpenAi, Anthropic, AiClient, Web };
