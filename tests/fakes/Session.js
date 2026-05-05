/**
 * FakeSession.
 *
 * Controls the email returned by Session.getActiveUser/getEffectiveUser in tests.
 * Default is one of Config.ALLOWED_EMAILS so existing tests pass the allowlist
 * gate without per-test setup. Override via _setUserEmail('').
 *
 * In real Apps Script:
 *   - getActiveUser() may return "" for personal Gmail in cross-domain scenarios.
 *   - getEffectiveUser() is reliable when userinfo.email scope is granted.
 * The fake returns the same email from both — tests that need to simulate the
 * quirk can override via _setUserEmail('').
 */

const DEFAULT_EMAIL = 'user2@example.com'; // one of Config.ALLOWED_EMAILS

let _userEmail = DEFAULT_EMAIL;

function makeFakeSession() {
  return {
    getActiveUser() {
      return { getEmail: () => _userEmail };
    },
    getEffectiveUser() {
      return { getEmail: () => _userEmail };
    },

    // Test helpers.
    _setUserEmail(email) { _userEmail = email; },
    _reset() { _userEmail = DEFAULT_EMAIL; },
  };
}

module.exports = { makeFakeSession, DEFAULT_EMAIL };
