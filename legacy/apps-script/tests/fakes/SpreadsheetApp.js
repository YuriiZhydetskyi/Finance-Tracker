/**
 * In-memory FakeSpreadsheetApp.
 *
 * Implements the surface used by src/Storage.js and src/Smoke.js:
 *   - SpreadsheetApp.openById(id)
 *   - Spreadsheet.getSheetByName(name)
 *   - Sheet.getLastRow / getLastColumn / appendRow / deleteRow / getRange / getDataRange
 *   - Range.getValues / setValues
 *
 * Test helpers (not in real Apps Script API):
 *   - createSheetWithHeaders(name, headers) — populates a sheet with row 0 = headers
 *   - getRows(name) — returns the raw 2D array for inspection in assertions
 */

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowData = [];
      for (let c = 0; c < this.numCols; c++) {
        const sheetRow = this.sheet._data[this.row - 1 + r] || [];
        rowData.push(sheetRow[this.col - 1 + c] !== undefined ? sheetRow[this.col - 1 + c] : '');
      }
      out.push(rowData);
    }
    return out;
  }

  setValues(values) {
    if (values.length !== this.numRows) {
      throw new Error(`setValues: expected ${this.numRows} rows, got ${values.length}`);
    }
    for (let r = 0; r < this.numRows; r++) {
      const sheetRowIdx = this.row - 1 + r;
      while (this.sheet._data.length <= sheetRowIdx) this.sheet._data.push([]);
      for (let c = 0; c < this.numCols; c++) {
        this.sheet._data[sheetRowIdx][this.col - 1 + c] = values[r][c];
      }
    }
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    /** @type {any[][]} 0-indexed rows; row 0 is the header. */
    this._data = [];
  }

  appendRow(row) {
    this._data.push([...row]);
  }

  deleteRow(rowIndex) {
    // Apps Script rowIndex is 1-based.
    this._data.splice(rowIndex - 1, 1);
  }

  getLastRow() {
    return this._data.length;
  }

  getLastColumn() {
    if (this._data.length === 0) return 0;
    return Math.max(...this._data.map(r => r.length));
  }

  getRange(row, col, numRows, numCols) {
    if (numRows === undefined) numRows = 1;
    if (numCols === undefined) numCols = 1;
    return new FakeRange(this, row, col, numRows, numCols);
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, this.getLastRow(), this.getLastColumn());
  }
}

class FakeSpreadsheet {
  constructor() {
    /** @type {Record<string, FakeSheet>} */
    this._sheets = {};
  }

  getSheetByName(name) {
    return this._sheets[name] || null;
  }

  // ----- Test helpers -----

  createSheetWithHeaders(name, headers) {
    const s = new FakeSheet(name);
    s._data.push([...headers]);
    this._sheets[name] = s;
    return s;
  }
}

const spreadsheets = new Map();

function makeFakeSpreadsheetApp() {
  return {
    openById(id) {
      if (!spreadsheets.has(id)) spreadsheets.set(id, new FakeSpreadsheet());
      return spreadsheets.get(id);
    },

    // Test helper to reset state between tests.
    _reset() {
      spreadsheets.clear();
    },
  };
}

module.exports = { makeFakeSpreadsheetApp, FakeSpreadsheet, FakeSheet, FakeRange };
