/**
 * FakeLockService.
 *
 * Always returns a successful lock. We don't simulate concurrency in unit tests
 * — Storage._withLock semantic verification happens via tryLock spy.
 */

let _lockCount = 0;
let _releaseCount = 0;

function makeFakeLockService() {
  return {
    getScriptLock() {
      return {
        tryLock(_timeoutMs) {
          _lockCount++;
          return true;
        },
        releaseLock() {
          _releaseCount++;
        },
      };
    },

    // Test helpers.
    _stats() { return { lockCount: _lockCount, releaseCount: _releaseCount }; },
    _reset() { _lockCount = 0; _releaseCount = 0; },
  };
}

module.exports = { makeFakeLockService };
