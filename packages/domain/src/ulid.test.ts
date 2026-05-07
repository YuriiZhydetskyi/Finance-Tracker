import { describe, it, expect } from 'vitest';
import { ULID_REGEX, ulid } from './ulid';

describe('ulid', () => {
  it('returns 26 Crockford Base32 characters', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(ULID_REGEX.test(id)).toBe(true);
  });

  it('produces 100 unique IDs in a tight loop', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(ulid());
    expect(ids.size).toBe(100);
  });

  it('is time-sortable across a 10ms gap', async () => {
    const before = ulid();
    await new Promise((r) => setTimeout(r, 10));
    const after = ulid();
    expect(after > before).toBe(true);
  });
});
