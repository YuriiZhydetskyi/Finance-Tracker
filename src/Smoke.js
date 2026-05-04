/**
 * Smoke: manual test functions runnable from the Apps Script editor.
 *
 * Each function logs results via Logger.log so the output is visible in
 * Executions. None of these are wired into doGet/doPost — they only run
 * when invoked from the editor's Run dropdown or from another function.
 *
 * Suggested order to run after a fresh deploy:
 *   1. smokeIdentity        — verifies Session.getActiveUser email behavior
 *   2. smokeUlid            — generates a few ULIDs to confirm the algorithm
 *   3. smokeCategoriesRead  — confirms Sheet headers + 20-row seed loaded
 *   4. smokeFxBackfill      — populates last 90 days of rates
 *   5. smokeFxLookup        — resolves a USD/UAH rate for today
 *   6. smokeReceiptRoundtrip — INSERT a fake receipt + items, fetch, delete
 *   7. smokeLockService     — confirms LockService is available on this account
 */

/* exported Smoke */
const Smoke = {

  smokeIdentity() {
    const email = Session.getActiveUser().getEmail();
    Logger.log(`Session.getActiveUser().getEmail() → "${email}"`);
    if (email === '') {
      Logger.log(
        'Empty string returned. This is the documented quirk for personal Gmail ' +
        'accounts without a Google Workspace domain. Phase 3 UI will fall back ' +
        'to an explicit user-toggle stored in localStorage.'
      );
    } else {
      Logger.log('Identity works server-side. paid_by can be auto-populated.');
    }
    return email;
  },

  smokeUlid() {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(Domain.ulid());
      Utilities.sleep(2);
    }
    Logger.log('Generated ULIDs:');
    ids.forEach(id => Logger.log(`  ${id}`));
    Logger.log(`Length 26: ${ids.every(id => id.length === 26)}`);
    Logger.log(`All unique: ${new Set(ids).size === ids.length}`);
    const sorted = [...ids].sort();
    Logger.log(`Time-sortable: ${sorted.join('') === ids.join('')}`);
    return ids;
  },

  smokeCategoriesRead() {
    const cats = Storage.getCategories();
    Logger.log(`Categories loaded: ${cats.length}`);
    cats.forEach(c => Logger.log(`  ${c.name} (${c.group})`));
    if (cats.length !== 20) {
      Logger.log(`WARNING: expected 20 seed categories, got ${cats.length}. Re-check the Sheet.`);
    }
    return cats.length;
  },

  smokeFxBackfill() {
    Logger.log('Fetching ECB hist-90d.xml ...');
    const added = Fx.backfill90Days();
    Logger.log(`Appended ${added} new rate rows to FxRates.`);
    return added;
  },

  smokeFxLookup() {
    const today = Domain.todayIso();
    const usd = Fx.getRate('USD', today);
    const uah = Fx.getRate('UAH', today);
    const eur = Fx.getRate('EUR', today);
    Logger.log(`Rates as of ${today} (or latest ≤ today via fallback rule):`);
    Logger.log(`  EUR → EUR: ${eur} (must be 1.0)`);
    Logger.log(`  USD → EUR: ${usd}`);
    Logger.log(`  UAH → EUR: ${uah}`);
    return { eur, usd, uah };
  },

  smokeReceiptRoundtrip() {
    const today = Domain.todayIso();
    const myEmail = Session.getActiveUser().getEmail() || 'smoke-test@example.com';

    Logger.log('Building Receipt + 2 Items ...');
    const receipt = Domain.makeReceipt({
      date: today,
      store: 'SMOKE_TEST_STORE',
      currency: 'EUR',
      total_orig: 5.49,
      fx_rate_eur: 1.0,
      paid_by: myEmail,
      source: 'manual',
      note: 'smoke test — delete me',
    });
    const item1 = Domain.makeItem({
      receipt_id: receipt.id,
      product_id: null,
      product_name: 'Smoke Bread 500g',
      category: 'Бакалія',
      qty: 1,
      unit_price_orig: 2.49,
      fx_rate_eur: 1.0,
      consumed_by: 'shared',
      note: null,
    });
    const item2 = Domain.makeItem({
      receipt_id: receipt.id,
      product_id: null,
      product_name: 'Smoke Milk 1L',
      category: 'Молочка',
      qty: 1,
      unit_price_orig: 3.00,
      fx_rate_eur: 1.0,
      consumed_by: 'shared',
      note: null,
    });

    Logger.log(`INSERT Receipt ${receipt.id}`);
    Storage.appendReceipt(receipt);
    Logger.log(`INSERT 2 Items`);
    Storage.appendItems([item1, item2]);

    Logger.log('SELECT Receipt by id ...');
    const fetched = Storage.getReceipt(receipt.id);
    Logger.log(`  Got: ${JSON.stringify(fetched)}`);

    Logger.log('SELECT Items by receipt_id ...');
    const fetchedItems = Storage.getItemsByReceipt(receipt.id);
    Logger.log(`  Got ${fetchedItems.length} items`);
    fetchedItems.forEach(it => Logger.log(`    ${it.product_name} — €${it.total_eur}`));

    Logger.log('DELETE Receipt (cascades to items) ...');
    Storage.deleteReceipt(receipt.id);

    const stillThere = Storage.getReceipt(receipt.id);
    const itemsAfter = Storage.getItemsByReceipt(receipt.id);
    Logger.log(`After delete: receipt=${stillThere}, items=${itemsAfter.length}`);
    if (stillThere !== null || itemsAfter.length !== 0) {
      Logger.log('WARNING: cleanup incomplete — check Sheet manually.');
    } else {
      Logger.log('Roundtrip OK.');
    }
  },

  smokeLockService() {
    Logger.log('Acquiring document lock ...');
    const lock = LockService.getScriptLock();
    if (lock.tryLock(2000)) {
      Logger.log('Lock acquired.');
      lock.releaseLock();
      Logger.log('Lock released.');
    } else {
      Logger.log('Failed to acquire lock within 2s.');
    }
  },
};

// ============================================================
// Top-level wrappers (for the editor's Run dropdown)
// ============================================================

/* exported smokeIdentity, smokeUlid, smokeCategoriesRead, smokeFxBackfill,
            smokeFxLookup, smokeReceiptRoundtrip, smokeLockService */
function smokeIdentity()           { return Smoke.smokeIdentity(); }
function smokeUlid()               { return Smoke.smokeUlid(); }
function smokeCategoriesRead()     { return Smoke.smokeCategoriesRead(); }
function smokeFxBackfill()         { return Smoke.smokeFxBackfill(); }
function smokeFxLookup()           { return Smoke.smokeFxLookup(); }
function smokeReceiptRoundtrip()   { return Smoke.smokeReceiptRoundtrip(); }
function smokeLockService()        { return Smoke.smokeLockService(); }

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Smoke };
