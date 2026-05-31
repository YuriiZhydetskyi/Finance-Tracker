import { describe, it, expect } from 'vitest';
import { normalizeCandidate, parseJsonText, toReceiptCandidates } from './ManualJsonImportDialog';

describe('parseJsonText', () => {
  it('parses raw JSON', () => {
    expect(parseJsonText('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips ```json fenced code block', () => {
    const input = '```json\n{"store": "Lidl"}\n```';
    expect(parseJsonText(input)).toEqual({ store: 'Lidl' });
  });

  it('strips unlabelled fenced code block', () => {
    const input = '```\n{"store": "Lidl"}\n```';
    expect(parseJsonText(input)).toEqual({ store: 'Lidl' });
  });

  it('recovers JSON surrounded by prose via brace fallback', () => {
    const input = 'Here is the data: {"a": 1, "b": "x"} that you asked for';
    expect(parseJsonText(input)).toEqual({ a: 1, b: 'x' });
  });

  it('throws a friendly error for empty input', () => {
    expect(() => parseJsonText('')).toThrow(/Спочатку вставте JSON/);
    expect(() => parseJsonText('   \n   ')).toThrow(/Спочатку вставте JSON/);
  });

  it('throws a friendly error when no braces are present', () => {
    expect(() => parseJsonText('not json at all')).toThrow(/Не вдалося розпарсити JSON/);
  });

  it('fails brace-fallback when trailing prose also contains "}"', () => {
    // Documented edge case: indexOf('{') / lastIndexOf('}') overshoots when
    // trailing prose has '}'. JSON.parse then throws the friendly fallback.
    const input = 'before {"a": 1} more } trailing';
    expect(() => parseJsonText(input)).toThrow(/Не вдалося розпарсити JSON/);
  });
});

describe('normalizeCandidate', () => {
  it('passes through arrays unchanged', () => {
    expect(normalizeCandidate([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('passes through primitives unchanged', () => {
    expect(normalizeCandidate('x')).toBe('x');
    expect(normalizeCandidate(42)).toBe(42);
    expect(normalizeCandidate(null)).toBeNull();
  });

  it('passes through plain receipt object unchanged', () => {
    const value = { store: 'Lidl', items: [{ name: 'Bread' }] };
    expect(normalizeCandidate(value)).toEqual(value);
  });

  it('unwraps { receipt: {...}, items: [...] } shape', () => {
    const value = {
      receipt: { store: 'Lidl', date: '2026-05-01' },
      items: [{ name: 'Bread' }],
    };
    expect(normalizeCandidate(value)).toEqual({
      store: 'Lidl',
      date: '2026-05-01',
      items: [{ name: 'Bread' }],
    });
  });

  it('unwraps { receipt: { ..., items: [...] } } nested-items shape', () => {
    const value = {
      receipt: { store: 'Lidl', date: '2026-05-01', items: [{ name: 'Bread' }] },
    };
    expect(normalizeCandidate(value)).toEqual({
      store: 'Lidl',
      date: '2026-05-01',
      items: [{ name: 'Bread' }],
    });
  });

  it('prefers top-level items when both top-level and nested are present', () => {
    const value = {
      receipt: { store: 'Lidl', items: [{ name: 'Nested' }] },
      items: [{ name: 'Top' }],
    };
    const result = normalizeCandidate(value) as { items: { name: string }[] };
    expect(result.items).toEqual([{ name: 'Top' }]);
  });

  it('returns original when receipt has no items at any level', () => {
    const value = { receipt: { store: 'Lidl' } };
    expect(normalizeCandidate(value)).toBe(value);
  });
});

describe('toReceiptCandidates', () => {
  it('wraps a single receipt object in a one-element list', () => {
    const value = { store: 'Lidl', items: [{ name: 'Bread' }] };
    expect(toReceiptCandidates(value)).toEqual([value]);
  });

  it('returns each element of a top-level array', () => {
    const a = { store: 'Lidl', items: [] };
    const b = { store: 'Aldi', items: [] };
    expect(toReceiptCandidates([a, b])).toEqual([a, b]);
  });

  it('unwraps a { receipts: [...] } wrapper', () => {
    const a = { store: 'Lidl', items: [] };
    const b = { store: 'Aldi', items: [] };
    expect(toReceiptCandidates({ receipts: [a, b] })).toEqual([a, b]);
  });

  it('normalizes each element of an array', () => {
    const wrapped = { receipt: { store: 'Lidl', date: '2026-05-01' }, items: [{ name: 'Bread' }] };
    expect(toReceiptCandidates([wrapped])).toEqual([
      { store: 'Lidl', date: '2026-05-01', items: [{ name: 'Bread' }] },
    ]);
  });

  it('returns an empty list for an empty array', () => {
    expect(toReceiptCandidates([])).toEqual([]);
  });
});
