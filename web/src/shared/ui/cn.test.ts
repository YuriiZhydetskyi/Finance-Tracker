import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins class strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('skips falsy values', () => {
    const showB = false as boolean;
    expect(cn('a', showB && 'b', null, undefined, 'c')).toBe('a c');
  });

  it('merges Tailwind utilities (later wins)', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('keeps non-conflicting classes', () => {
    expect(cn('px-4 py-2', 'bg-white')).toBe('px-4 py-2 bg-white');
  });
});
