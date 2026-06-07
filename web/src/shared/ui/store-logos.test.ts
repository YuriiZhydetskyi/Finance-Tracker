import { describe, it, expect } from 'vitest';
import { resolveStoreLogo } from './store-logos';

describe('resolveStoreLogo', () => {
  it("matches McDonald's despite the apostrophe", () => {
    expect(resolveStoreLogo("McDonald's")?.id).toBe('mcdonalds');
  });

  it('matches a brand token embedded in a longer statement name', () => {
    expect(resolveStoreLogo('Lidl sagt Danke')?.id).toBe('lidl');
  });

  it('matches regardless of case and diacritics', () => {
    expect(resolveStoreLogo('ALDI SÜD')?.id).toBe('aldi');
  });

  it('matches "dm" only as a standalone token, not inside another word', () => {
    expect(resolveStoreLogo('dm')?.id).toBe('dm');
    expect(resolveStoreLogo('Edmundo')).toBeNull();
  });

  it('matches Amazon', () => {
    expect(resolveStoreLogo('Amazon')?.id).toBe('amazon');
  });

  it('returns null for unknown stores', () => {
    expect(resolveStoreLogo('оренда')).toBeNull();
    expect(resolveStoreLogo('Mangal')).toBeNull();
  });
});
