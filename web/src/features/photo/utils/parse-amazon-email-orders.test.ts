import { describe, expect, it } from 'vitest';
import { looksLikeAmazonEmailOrders, parseAmazonEmailOrders } from './parse-amazon-email-orders';

const balancedOrder = {
  order_number: '302-1234567-1234567',
  date: '2026-09-01T12:34:56Z',
  total: '25.00 EUR',
  return_info: null,
  items: [
    {
      title: 'Protein',
      quantity: 2,
      price: '12.50 EUR',
      asin: 'B012345678',
      product_link: 'https://www.amazon.de/dp/B012345678',
      image: 'https://m.media-amazon.com/images/I/example.jpg',
      category: 'Бакалія',
    },
  ],
};

describe('parseAmazonEmailOrders', () => {
  it('converts a balanced Amazon order while retaining safe product metadata', () => {
    const result = parseAmazonEmailOrders([balancedOrder]);

    expect(result.skipped).toEqual([]);
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({
      store: 'Amazon',
      date: '2026-09-01',
      time: '14:34',
      merchant_order_id: '302-1234567-1234567',
      total_orig: 25,
    });
    expect(result.receipts[0]?.items[0]).toMatchObject({
      product_code: 'B012345678',
      product_url: 'https://www.amazon.de/dp/B012345678',
      product_image_url: 'https://m.media-amazon.com/images/I/example.jpg',
      category_suggestion: 'Бакалія',
    });
  });

  it('skips a fully returned order', () => {
    const result = parseAmazonEmailOrders([
      { ...balancedOrder, return_info: { refund_amount: '25.00 EUR' } },
    ]);

    expect(result.receipts).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/усі позиції/);
  });

  it('skips a cancelled order recorded in Amazon order history', () => {
    const result = parseAmazonEmailOrders([
      { ...balancedOrder, order_history_status: 'cancelled' },
    ]);

    expect(result.receipts).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/скасоване/);
  });

  it('retains Gmail amounts only as audit evidence after total reconciliation', () => {
    const result = parseAmazonEmailOrders([
      {
        ...balancedOrder,
        gmail_total: '10.00 EUR',
        items: [{ ...balancedOrder.items[0], gmail_price: '10.00 EUR' }],
      },
    ]);

    expect(result.receipts[0]?.total_raw_text).toBe('25.00 EUR (Gmail total 10.00 EUR)');
    expect(result.receipts[0]?.items[0]?.raw_text).toBe('12.50 EUR (Gmail price 10.00 EUR)');
  });

  it('retains non-returned items when a refund exactly matches one item', () => {
    const result = parseAmazonEmailOrders([
      {
        ...balancedOrder,
        total: '21.49 EUR',
        return_info: { refund_amount: '12.50 EUR' },
        items: [
          { ...balancedOrder.items[0], quantity: 1 },
          {
            title: 'Shoelaces',
            quantity: 1,
            price: '8.99 EUR',
            asin: null,
            product_link: null,
            image: null,
          },
        ],
      },
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.receipts[0]).toMatchObject({ total_orig: 8.99, article_count: 1 });
    expect(result.receipts[0]?.items[0]?.product_name).toBe('Shoelaces');
  });

  it('does not invent a discount when email totals and item prices disagree', () => {
    const result = parseAmazonEmailOrders([{ ...balancedOrder, total: '20.00 EUR' }]);

    expect(result.receipts).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/не дорівнює/);
  });

  it('does not treat unrelated JSON as the Amazon email contract', () => {
    expect(looksLikeAmazonEmailOrders([{ store: 'Amazon' }])).toBe(false);
  });
});
