// Crockford-Base32 ULID: 10-char timestamp + 16-char randomness, time-sortable.
// Uniqueness is probabilistic (Math.random) — sufficient for a 2-user app
// generating <1000 IDs/day. See data-model.md §Identity.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' as const;
const ALPHABET_LEN = 32;
const TIME_LEN = 10;
const RAND_LEN = 16;

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function ulid(): string {
  let timeStr = '';
  let t = Date.now();
  for (let i = 0; i < TIME_LEN; i++) {
    timeStr = ALPHABET[t % ALPHABET_LEN] + timeStr;
    t = Math.floor(t / ALPHABET_LEN);
  }

  let randStr = '';
  for (let i = 0; i < RAND_LEN; i++) {
    randStr += ALPHABET[Math.floor(Math.random() * ALPHABET_LEN)];
  }

  return timeStr + randStr;
}
