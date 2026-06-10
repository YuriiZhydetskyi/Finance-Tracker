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

  it('matches the two-word "Burger King" but not an unrelated "Burger ..." store', () => {
    expect(resolveStoreLogo('Burger King')?.id).toBe('burgerking');
    expect(resolveStoreLogo('BURGER KING 4711 BERLIN')?.id).toBe('burgerking');
    expect(resolveStoreLogo('Burger House')).toBeNull();
  });

  it("matches Domino's via its normalized token", () => {
    expect(resolveStoreLogo("Domino's Pizza")?.id).toBe('dominos');
  });

  it('matches Wizz Air via the "wizz" token', () => {
    expect(resolveStoreLogo('Wizz Air')?.id).toBe('wizzair');
  });

  it('matches Too Good To Go as a multi-word phrase', () => {
    expect(resolveStoreLogo('Too Good To Go')?.id).toBe('toogoodtogo');
  });

  it('matches TK Maxx with space', () => {
    expect(resolveStoreLogo('TK Maxx')?.id).toBe('tkmaxx');
  });

  it('matches Meta and Facebook to the same logo', () => {
    expect(resolveStoreLogo('Meta')?.id).toBe('meta');
    expect(resolveStoreLogo('Facebook')?.id).toBe('meta');
  });

  it('matches ChatGPT to OpenAI logo', () => {
    expect(resolveStoreLogo('ChatGPT')?.id).toBe('openai');
  });

  it('returns null for unknown stores', () => {
    expect(resolveStoreLogo('оренда')).toBeNull();
    expect(resolveStoreLogo('Mangal')).toBeNull();
  });
});
