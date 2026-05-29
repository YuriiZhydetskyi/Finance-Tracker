const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Short, URL-friendly token for a shared price link. It only needs to be unique
 * enough to avoid collisions in the table — the link isn't a secret, so a fast
 * Math.random-based generator is plenty.
 */
export function generateShareToken(length = 10): string {
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return token;
}
