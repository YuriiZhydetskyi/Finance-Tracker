/**
 * Apps Script fakes — single entry point.
 *
 * Call installAllFakes() from a test's beforeEach (or once at top) to set up
 * Apps Script globals on the Node side. Returns the fake instances so tests
 * can call test helpers (e.g., spreadsheet.createSheetWithHeaders, urlFetch
 * stub registration, session email override).
 *
 * Each fake exposes _reset() — call resetAllFakes() between tests for isolation.
 */

const { makeFakeSpreadsheetApp } = require('./SpreadsheetApp');
const { makeFakeUrlFetchApp } = require('./UrlFetchApp');
const { makeFakeLockService } = require('./LockService');
const { makeFakeSession } = require('./Session');
const { makeFakeXmlService } = require('./XmlService');
const { makeFakeDriveApp } = require('./DriveApp');

let _fakes = null;

function installAllFakes() {
  if (_fakes) return _fakes;

  _fakes = {
    SpreadsheetApp: makeFakeSpreadsheetApp(),
    UrlFetchApp: makeFakeUrlFetchApp(),
    LockService: makeFakeLockService(),
    Session: makeFakeSession(),
    XmlService: makeFakeXmlService(),
    DriveApp: makeFakeDriveApp(),
  };

  global.SpreadsheetApp = _fakes.SpreadsheetApp;
  global.UrlFetchApp = _fakes.UrlFetchApp;
  global.LockService = _fakes.LockService;
  global.Session = _fakes.Session;
  global.XmlService = _fakes.XmlService;
  global.DriveApp = _fakes.DriveApp;

  return _fakes;
}

function resetAllFakes() {
  if (!_fakes) return;
  _fakes.SpreadsheetApp._reset();
  _fakes.UrlFetchApp._reset();
  _fakes.LockService._reset();
  _fakes.Session._reset();
  // XmlService / DriveApp have no per-test state.
}

module.exports = { installAllFakes, resetAllFakes };
