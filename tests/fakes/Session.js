/**
 * FakeSession.
 *
 * Controls the email returned by Session.getActiveUser().getEmail() in tests.
 * Use _setUserEmail('') to simulate the personal-Gmail empty-string quirk.
 */

let _userEmail = 'test@example.com';

function makeFakeSession() {
  return {
    getActiveUser() {
      return { getEmail: () => _userEmail };
    },

    // Test helpers.
    _setUserEmail(email) { _userEmail = email; },
    _reset() { _userEmail = 'test@example.com'; },
  };
}

module.exports = { makeFakeSession };
