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

// PropertiesService stub for Config getters.
global.PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(key) {
        const stubs = {
          SHEET_ID: 'fake-sheet-id',
          DRIVE_FOLDER_ID: 'fake-drive-folder',
          GEMINI_API_KEY: 'fake-gemini-key',
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

module.exports = { fakes, resetAllFakes, Config, Domain, Storage, Fx };
