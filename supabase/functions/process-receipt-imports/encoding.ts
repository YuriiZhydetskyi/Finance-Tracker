const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function ulid(): string {
  let timestamp = Date.now();
  let time = '';
  for (let index = 0; index < 10; index += 1) {
    time = ALPHABET[timestamp % 32] + time;
    timestamp = Math.floor(timestamp / 32);
  }
  let random = '';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of bytes) random += ALPHABET[byte % 32];
  return time + random;
}
