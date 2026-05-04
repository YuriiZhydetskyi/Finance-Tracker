/**
 * FakeDriveApp.
 *
 * In-memory implementation for Phase 3 photo-upload tests. Supports the
 * subset of DriveApp used by Web.js and Smoke.js:
 *   - DriveApp.getFolderById(id) → folder
 *   - folder.createFile(blob) → file
 *   - folder.getFilesByType(mime) → iterator (used by smokeGeminiParse)
 *   - file.getUrl(), file.getId(), file.getName(), file.getSize()
 *
 * Tests can inspect/clear state via the fake's _files getter and _reset().
 */

function makeFakeDriveApp() {
  /** @type {Map<string, {_files: any[]}>} */
  const folders = new Map();
  let fileCounter = 0;

  function ensureFolder(id) {
    if (!folders.has(id)) folders.set(id, { _files: [] });
    return folders.get(id);
  }

  function makeFile(blob) {
    const fid = `fake-file-${++fileCounter}`;
    return {
      _id: fid,
      _blob: blob,
      getId() { return fid; },
      getUrl() { return `https://drive.fake/file/${fid}`; },
      getName() { return blob && blob.getName ? blob.getName() : 'noname'; },
      getSize() {
        if (!blob || !blob.getBytes) return 0;
        const b = blob.getBytes();
        return b ? b.length : 0;
      },
      getBlob() { return blob; },
    };
  }

  return {
    getFolderById(id) {
      const folder = ensureFolder(id);
      return {
        _files: folder._files,
        createFile(blob) {
          const file = makeFile(blob);
          folder._files.push(file);
          return file;
        },
        getFilesByType(_mime) {
          const arr = folder._files.slice();
          let i = 0;
          return {
            hasNext() { return i < arr.length; },
            next() { return arr[i++]; },
          };
        },
      };
    },

    // Test helpers
    _files(folderId) {
      return folders.has(folderId) ? folders.get(folderId)._files.slice() : [];
    },
    _reset() {
      folders.clear();
      fileCounter = 0;
    },
  };
}

module.exports = { makeFakeDriveApp };
