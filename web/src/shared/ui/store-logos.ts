// Maps a free-text store name (`receipt.store`) to a known brand logo served
// from /public/store-logos. Reuses the same name normalizer as statement
// reconciliation so "McDonald's" / "MCDONALDS BERLIN" / "Café" collapse the
// same way everywhere. Match is token-based, not substring: a keyword fires only
// when ALL of its words appear as whole tokens. So "dm" never fires on "Edmundo",
// and the two-word "burger king" matches "Burger King" but not "Burger House".

import { normalizeStoreName } from '@finance-tracker/domain';

export type StoreLogo = { id: string; src: string; keywords: string[] };

// keywords are normalized tokens / token phrases (lowercase, no punctuation) —
// they must match what normalizeStoreName produces. A multi-word keyword matches
// only when every one of its words is present (order-independent).
const LOGOS: StoreLogo[] = [
  // Supermarkets
  { id: 'lidl', src: '/store-logos/lidl.svg', keywords: ['lidl'] },
  { id: 'aldi', src: '/store-logos/aldi.svg', keywords: ['aldi'] },
  { id: 'rewe', src: '/store-logos/rewe.svg', keywords: ['rewe'] },
  { id: 'edeka', src: '/store-logos/edeka.svg', keywords: ['edeka'] },
  { id: 'kaufland', src: '/store-logos/kaufland.svg', keywords: ['kaufland'] },
  { id: 'penny', src: '/store-logos/penny.svg', keywords: ['penny'] },
  { id: 'netto', src: '/store-logos/netto.svg', keywords: ['netto'] },
  { id: 'norma', src: '/store-logos/norma.svg', keywords: ['norma'] },
  // Drugstores
  { id: 'dm', src: '/store-logos/dm.svg', keywords: ['dm'] },
  { id: 'rossmann', src: '/store-logos/rossmann.svg', keywords: ['rossmann'] },
  // Fast food & restaurants
  {
    id: 'mcdonalds',
    src: '/store-logos/mcdonalds.svg',
    keywords: ['mcdonalds', 'mcdonald', 'mcd'],
  },
  { id: 'burgerking', src: '/store-logos/burgerking.svg', keywords: ['burger king', 'burgerking'] },
  { id: 'kfc', src: '/store-logos/kfc.svg', keywords: ['kfc'] },
  { id: 'starbucks', src: '/store-logos/starbucks.svg', keywords: ['starbucks'] },
  { id: 'subway', src: '/store-logos/subway.svg', keywords: ['subway'] },
  { id: 'dominos', src: '/store-logos/dominos.svg', keywords: ['dominos'] },
  // Electronics
  { id: 'mediamarkt', src: '/store-logos/mediamarkt.svg', keywords: ['mediamarkt'] },
  { id: 'saturn', src: '/store-logos/saturn.svg', keywords: ['saturn'] },
  // Gas stations
  { id: 'shell', src: '/store-logos/shell.svg', keywords: ['shell'] },
  // Furniture & home
  { id: 'ikea', src: '/store-logos/ikea.svg', keywords: ['ikea'] },
  // Online & fashion
  { id: 'amazon', src: '/store-logos/amazon.svg', keywords: ['amazon'] },
  { id: 'zalando', src: '/store-logos/zalando.svg', keywords: ['zalando'] },
  { id: 'hm', src: '/store-logos/hm.svg', keywords: ['hm'] },
  // Bakery
  { id: 'backwerk', src: '/store-logos/backwerk.svg', keywords: ['backwerk'] },
  // Transport
  { id: 'db', src: '/store-logos/db.svg', keywords: ['bahn', 'db'] },
];

const cache = new Map<string, StoreLogo | null>();

export function resolveStoreLogo(store: string): StoreLogo | null {
  const key = normalizeStoreName(store);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const tokens = new Set(key.split(' '));
  const hit =
    LOGOS.find((l) => l.keywords.some((k) => k.split(' ').every((part) => tokens.has(part)))) ??
    null;
  cache.set(key, hit);
  return hit;
}
