const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Accepts both the standard and the URL-safe alphabet, with or without padding. */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
