/**
 * FakeDriveApp.
 *
 * No-op stub. Phase 1 doesn't call DriveApp; declared for completeness so
 * that Storage / Fx code that may reference it in the future doesn't crash
 * during tests. Phase 3 (photo upload) will need real fake methods.
 */

function makeFakeDriveApp() {
  return {
    getFolderById(_id) {
      throw new Error('FakeDriveApp.getFolderById: not implemented in Phase 1 fakes');
    },
    createFile(_blob) {
      throw new Error('FakeDriveApp.createFile: not implemented in Phase 1 fakes');
    },
  };
}

module.exports = { makeFakeDriveApp };
