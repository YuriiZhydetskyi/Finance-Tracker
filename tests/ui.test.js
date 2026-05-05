/**
 * Page-level UI tests via JSDOM + Alpine (Sub-block B).
 *
 * Covers:
 *   - Every page boots Alpine without throwing (x-cloak removed = factory survived init).
 *   - Every page declares <base target="_top"> (iframe navigation guard).
 *   - index: identity modal opens when whoAmI returns "" and localStorage is empty.
 *   - index: server email skips modal and shows up in topbar.
 *   - recent: listRecent results render as <li> rows.
 *   - edit: getReceipt populates the form fields.
 *   - photo: initial step exposes a file input.
 *
 * Bugs caught (relative to the Phase 3 deploy regressions):
 *   - x-data factory throwing (e.g. missing helper from webapp.html).
 *   - <base target="_top"> missing (the iframe nav blank-page bug).
 *   - Wrong runServer call shape from a page's init/save handler.
 */

const test = require('node:test');
const assert = require('node:assert');

const { Web } = require('./bootstrap');
const { renderPage } = require('./uiHarness');

function defaultStubs() {
  return {
    whoAmI: () => 'me@example.com',
    listRecent: () => [],
    getCategories: () => [],
    listProducts: () => [],
    getReceipt: (id) => id === 'ABC' ? {
      receipt: {
        id: 'ABC', date: '2026-05-01', store: 'Smoke Store', currency: 'EUR',
        total_orig: 5, fx_rate_eur: 1, total_eur: 5, paid_by: 'me@example.com',
        photo_url: null, source: 'manual', raw_ocr_json: null, note: null,
        created_at: '2026-05-01T10:00:00+02:00', updated_at: '2026-05-01T10:00:00+02:00',
      },
      items: [],
    } : null,
  };
}

// ============================================================
// Generic per-page smoke
// ============================================================

test('UI: every page boots Alpine without throwing (x-cloak removed)', async () => {
  for (const page of Web.PAGES) {
    const { document } = await renderPage({
      page,
      queryParams: page === 'edit' ? { id: 'ABC' } : {},
      runServerStubs: defaultStubs(),
    });
    assert.ok(
      !document.body.hasAttribute('x-cloak'),
      `page "${page}" body still has x-cloak after init — Alpine factory may have thrown`
    );
  }
});

test('UI: every page declares <base target="_top"> with non-empty href', async () => {
  for (const page of Web.PAGES) {
    const { document } = await renderPage({
      page,
      queryParams: page === 'edit' ? { id: 'ABC' } : {},
      runServerStubs: defaultStubs(),
    });
    const base = document.querySelector('base');
    assert.ok(base, `page "${page}" missing <base>`);
    assert.strictEqual(base.getAttribute('target'), '_top', `page "${page}" base target wrong`);
    assert.ok(base.getAttribute('href'), `page "${page}" base href empty`);
  }
});

// ============================================================
// Responsive design regression guards
//   Mobile-first redesign assumes specific head structure
//   (viewport meta, Google Fonts) on every page. These two
//   tests catch accidental removal in any future page change.
// ============================================================

test('UI: every page declares a mobile viewport meta', async () => {
  for (const page of Web.PAGES) {
    const { document } = await renderPage({
      page,
      queryParams: page === 'edit' ? { id: 'ABC' } : {},
      runServerStubs: defaultStubs(),
    });
    const vp = document.querySelector('meta[name="viewport"]');
    assert.ok(vp, `page "${page}" missing viewport meta`);
    assert.match(
      vp.getAttribute('content') || '',
      /width=device-width/,
      `page "${page}" viewport content lacks width=device-width`
    );
  }
});

test('UI: every page links the Google Fonts stylesheet', async () => {
  for (const page of Web.PAGES) {
    const { document } = await renderPage({
      page,
      queryParams: page === 'edit' ? { id: 'ABC' } : {},
      runServerStubs: defaultStubs(),
    });
    const link = document.querySelector('link[href*="fonts.googleapis.com"]');
    assert.ok(link, `page "${page}" missing Google Fonts <link>`);
  }
});

// ============================================================
// index.html identity flow
// ============================================================

test('UI index: empty whoAmI + no localStorage → "Хто ти?" modal opens', async () => {
  const { document } = await renderPage({
    page: 'index',
    runServerStubs: { whoAmI: () => '' },
  });
  // Alpine renders the modal as a real .modal-backdrop element when showWhoModal=true.
  // (The text inside <template x-if> isn't a reliable signal — template content
  // appears in textContent regardless of x-if state.)
  assert.ok(document.querySelector('.modal-backdrop'), 'modal not in DOM');
});

test('UI index: server email skips modal, shows in topbar', async () => {
  const { document } = await renderPage({
    page: 'index',
    runServerStubs: { whoAmI: () => 'me@example.com' },
  });
  // Email visible in the topbar's .who span.
  const who = document.querySelector('.topbar .who');
  assert.ok(who, '.topbar .who element missing');
  assert.match(who.textContent, /me@example\.com/);
  // Modal should NOT have been instantiated by Alpine.
  assert.ok(!document.querySelector('.modal-backdrop'), 'modal opened despite resolved identity');
});

// ============================================================
// recent.html
// ============================================================

test('UI recent: listRecent results render as <li> rows', async () => {
  const r1 = {
    id: 'R1', date: '2026-05-04', store: 'Lidl', currency: 'EUR',
    total_orig: 12.5, fx_rate_eur: 1, total_eur: 12.5, note: null,
  };
  const r2 = {
    id: 'R2', date: '2026-05-03', store: 'Aldi', currency: 'EUR',
    total_orig: 8.99, fx_rate_eur: 1, total_eur: 8.99, note: 'snack',
  };
  const { document } = await renderPage({
    page: 'recent',
    runServerStubs: {
      whoAmI: () => 'me@x',
      listRecent: () => [r1, r2],
    },
  });
  const lis = document.querySelectorAll('ul.receipt-list li');
  assert.strictEqual(lis.length, 2, 'expected 2 receipt rows');
  assert.match(lis[0].textContent, /Lidl/);
  assert.match(lis[1].textContent, /Aldi/);
});

test('UI recent: empty list shows the empty-state card', async () => {
  const { document } = await renderPage({
    page: 'recent',
    runServerStubs: {
      whoAmI: () => 'me@x',
      listRecent: () => [],
    },
  });
  assert.match(document.body.textContent, /Поки що порожньо/);
});

// ============================================================
// edit.html
// ============================================================

test('UI edit: getReceipt populates store input from server data', async () => {
  const { document } = await renderPage({
    page: 'edit',
    queryParams: { id: 'ABC' },
    runServerStubs: defaultStubs(),
  });
  const storeInput = document.querySelector('input[x-model="receipt.store"]');
  assert.ok(storeInput, 'store input not in DOM');
  assert.strictEqual(storeInput.value, 'Smoke Store');
});

test('UI edit: missing ?id renders the error message', async () => {
  const { document } = await renderPage({
    page: 'edit',
    runServerStubs: defaultStubs(),
  });
  assert.match(document.body.textContent, /Не вказано id чеку/);
});

// ============================================================
// photo.html
// ============================================================

test('UI photo: initial step is "pick", exposes a file input', async () => {
  const { document } = await renderPage({
    page: 'photo',
    runServerStubs: {
      whoAmI: () => 'me@x',
      getCategories: () => [],
      listProducts: () => [],
    },
  });
  const fileInput = document.querySelector('input[type="file"]');
  assert.ok(fileInput, 'photo page should expose file input on initial step');
  assert.strictEqual(fileInput.getAttribute('accept'), 'image/*');
});

test('UI photo: file input is wrapped by a styled .file-cta label and keeps capture=environment', async () => {
  const { document } = await renderPage({
    page: 'photo',
    runServerStubs: {
      whoAmI: () => 'me@x',
      getCategories: () => [],
      listProducts: () => [],
    },
  });
  // The big tap-target label is what the user actually presses on mobile —
  // a bare <input type="file"> has no styling on iOS. Guard against accidental
  // unwrapping in future redesigns.
  const cta = document.querySelector('label.file-cta');
  assert.ok(cta, 'photo page missing the .file-cta label wrapper');
  const fileInput = cta.querySelector('input[type="file"]');
  assert.ok(fileInput, '.file-cta should contain the file input');
  assert.strictEqual(
    fileInput.getAttribute('capture'), 'environment',
    'capture="environment" needed so the back camera opens directly on mobile'
  );
});

// ============================================================
// manual.html
// ============================================================

test('UI manual: renders empty form with one item row', async () => {
  const { document } = await renderPage({
    page: 'manual',
    runServerStubs: {
      whoAmI: () => 'me@x',
      getCategories: () => ['Бакалія', 'Молочка'],
      listProducts: () => [],
    },
  });
  // Page heading.
  assert.match(document.body.textContent, /Витрата вручну/);
  // ItemsTable seeds with newItemRow() — exactly one row visible.
  const productInputs = document.querySelectorAll('input[x-model="it.product_name"]');
  assert.strictEqual(productInputs.length, 1, 'expected exactly one initial item row');
});

test('UI manual: every item-card renders all four field labels (no x-show=idx===0 hack)', async () => {
  // Pre-redesign, only the first row showed labels (mobile-hostile because
  // each row scrolled away from its header). The new card layout repeats
  // labels per row. This test pins that behavior so a future "compaction"
  // doesn't silently revert it.
  const { document } = await renderPage({
    page: 'manual',
    runServerStubs: {
      whoAmI: () => 'me@x',
      getCategories: () => [],
      listProducts: () => [],
    },
  });
  const card = document.querySelector('.item-card');
  assert.ok(card, '.item-card not in DOM');
  const labels = card.querySelectorAll('label');
  assert.ok(
    labels.length >= 4,
    `expected at least 4 labels per item-card (Товар/Категорія/К-сть/Ціна), got ${labels.length}`
  );
});

test('UI manual: products datalist still wired to the product input', async () => {
  const { document } = await renderPage({
    page: 'manual',
    runServerStubs: {
      whoAmI: () => 'me@x',
      getCategories: () => [],
      listProducts: () => [{ id: 'p1', name: 'Молоко', category: 'Молочка' }],
    },
  });
  const list = document.getElementById('products-datalist');
  assert.ok(list, 'products-datalist missing');
  const productInput = document.querySelector('input[x-model="it.product_name"]');
  assert.ok(productInput, 'product input missing');
  assert.strictEqual(
    productInput.getAttribute('list'), 'products-datalist',
    'product input must reference the datalist by id'
  );
});

test('UI manual: item delete button is focusable and not disabled', async () => {
  const { document } = await renderPage({
    page: 'manual',
    runServerStubs: {
      whoAmI: () => 'me@x',
      getCategories: () => [],
      listProducts: () => [],
    },
  });
  const btn = document.querySelector('.item-delete');
  assert.ok(btn, '.item-delete button missing');
  assert.ok(!btn.disabled, '.item-delete must not be disabled');
  // tabIndex defaults to 0 for buttons; explicit -1 would remove from focus order.
  assert.ok(btn.tabIndex >= 0, '.item-delete must remain in focus order');
});

// ============================================================
// Bottom action bar (sticky CTAs on form pages)
// ============================================================

test('UI: photo/manual/edit each render a .bottom-bar with a "Зберегти" primary action', async () => {
  const formPages = [
    { page: 'manual', queryParams: {} },
    { page: 'edit', queryParams: { id: 'ABC' } },
  ];
  for (const { page, queryParams } of formPages) {
    const { document } = await renderPage({
      page, queryParams,
      runServerStubs: defaultStubs(),
    });
    const bar = document.querySelector('.bottom-bar');
    assert.ok(bar, `page "${page}" missing .bottom-bar`);
    assert.match(bar.textContent, /Зберегти/, `page "${page}" bottom bar missing "Зберегти" button`);
  }
  // Photo page renders the bottom bar inside the review step (x-show on a
  // wrapper). Markup is present in the DOM regardless of x-show state.
  const { document: photoDoc } = await renderPage({
    page: 'photo',
    runServerStubs: {
      whoAmI: () => 'me@x',
      getCategories: () => [],
      listProducts: () => [],
    },
  });
  const photoBar = photoDoc.querySelector('.bottom-bar');
  assert.ok(photoBar, 'photo page missing .bottom-bar');
  assert.match(photoBar.textContent, /Зберегти/, 'photo bottom bar missing "Зберегти" button');
});

// ============================================================
// Recent page: monospace tabular amounts
// ============================================================

test('UI recent: rendered receipts use the .tabular class for monospace amount alignment', async () => {
  const r = {
    id: 'R1', date: '2026-05-04', store: 'Lidl', currency: 'EUR',
    total_orig: 12.5, fx_rate_eur: 1, total_eur: 12.5, note: null,
  };
  const { document } = await renderPage({
    page: 'recent',
    runServerStubs: {
      whoAmI: () => 'me@x',
      listRecent: () => [r],
    },
  });
  const tabular = document.querySelector('.receipt-list .tabular');
  assert.ok(tabular, 'rendered receipt should have a .tabular amount span (mono numerals)');
});
