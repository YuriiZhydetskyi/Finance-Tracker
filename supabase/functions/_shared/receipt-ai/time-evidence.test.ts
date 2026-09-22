import { describe, expect, it } from 'vitest';
import { canonicalizeReceiptTime } from './time-evidence.ts';
import type { ParsedReceipt } from './types.ts';

function receipt(overrides: Partial<ParsedReceipt>): ParsedReceipt {
  return {
    store: 'EDEKA Straßfeld',
    date: '2026-05-02',
    currency: 'EUR',
    total_orig: 33.44,
    items: [],
    ...overrides,
  };
}

describe('canonicalizeReceiptTime', () => {
  it('prefers the fiscal sale time over a distinct card payment time', () => {
    const parsed = canonicalizeReceiptTime(
      receipt({
        time: '14:06',
        fiscal_time: '14:05',
        fiscal_time_raw_text: 'Datum Uhrzeit Filiale Pos Bed Bon 02.05.26 14:05',
        payment_time: '14:06',
        payment_time_raw_text: 'Kundenbeleg Uhrzeit: 14:06:46 Uhr',
      }),
    );

    expect(parsed).toMatchObject({
      time: '14:05',
      time_source: 'fiscal_receipt',
      fiscal_time: '14:05',
      payment_time: '14:06',
    });
  });

  it('uses payment time only when no fiscal sale time is visibly evidenced', () => {
    const parsed = canonicalizeReceiptTime(
      receipt({
        time: '20:14',
        fiscal_time: null,
        fiscal_time_raw_text: null,
        payment_time: '20:14:47',
        payment_time_raw_text: 'Kundenbeleg Uhrzeit: 20:14:47 Uhr',
      }),
    );

    expect(parsed).toMatchObject({
      time: '20:14',
      time_source: 'payment_receipt',
      payment_time: '20:14',
    });
  });

  it('drops a structured time when its claimed evidence does not contain that time', () => {
    const parsed = canonicalizeReceiptTime(
      receipt({
        time: '14:06',
        fiscal_time: '14:05',
        fiscal_time_raw_text: 'Datum Uhrzeit Filiale Pos Bed Bon 02.05.26 14:04',
        payment_time: null,
        payment_time_raw_text: null,
      }),
    );

    expect(parsed).toMatchObject({
      time: null,
      time_source: null,
      fiscal_time: null,
      payment_time: null,
    });
  });

  it('preserves a legacy time when no structured candidate fields exist', () => {
    const parsed = canonicalizeReceiptTime(receipt({ time: '09:17' }));

    expect(parsed.time).toBe('09:17');
  });
});
