import { z } from 'zod';
import type { ParsedReceipt } from '@finance-tracker/domain';

const MoneySchema = z.string().regex(/^\d+(?:\.\d{1,2})? [A-Z]{3}$/);

const AmazonItemSchema = z.object({
  title: z.string().min(1),
  quantity: z.number().finite().positive(),
  price: MoneySchema,
  asin: z.string().nullable(),
  product_link: z.string().nullable(),
  image: z.string().nullable(),
  category: z.string().min(1).nullable().optional(),
  gmail_price: MoneySchema.optional(),
});

const AmazonOrderSchema = z.object({
  order_number: z.string().regex(/^\d{3}-\d{7}-\d{7}$/),
  date: z.string().datetime(),
  items: z.array(AmazonItemSchema),
  total: MoneySchema,
  gmail_total: MoneySchema.optional(),
  order_history_status: z.enum(['cancelled', 'return_started']).optional(),
  return_info: z
    .object({
      refund_amount: MoneySchema.optional(),
    })
    .nullable(),
});

type Skip = { order_number: string; reason: string };

export type AmazonEmailOrderImport = {
  receipts: ParsedReceipt[];
  skipped: Skip[];
};

function parseMoney(value: string): { amount: number; currency: string } {
  const [amount, currency] = value.split(' ');
  return { amount: Number(amount), currency: currency ?? '' };
}

function moneyEquals(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

function berlinDateTime(value: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  if (!year || !month || !day || !hour || !minute) throw new Error('Некоректна дата Amazon');
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function trustedAmazonUrl(value: string | null, image: boolean): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const trusted = image
      ? url.hostname === 'm.media-amazon.com'
      : url.hostname === 'amazon.de' || url.hostname.endsWith('.amazon.de');
    return trusted ? url.toString() : null;
  } catch {
    return null;
  }
}

export function looksLikeAmazonEmailOrders(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (order) =>
        !!order &&
        typeof order === 'object' &&
        'order_number' in order &&
        'total' in order &&
        'items' in order,
    )
  );
}

/**
 * Converts a Gmail export, optionally reconciled with Amazon order history,
 * into the existing manual-review shape. The JSON is accepted only when its
 * final EUR total exactly equals the visible EUR item rows, so balance usage is
 * never mistaken for the full cost of purchased goods.
 */
export function parseAmazonEmailOrders(value: unknown): AmazonEmailOrderImport {
  if (!looksLikeAmazonEmailOrders(value)) return { receipts: [], skipped: [] };

  const receipts: ParsedReceipt[] = [];
  const skipped: Skip[] = [];

  value.forEach((rawOrder, index) => {
    const parsed = AmazonOrderSchema.safeParse(rawOrder);
    if (!parsed.success) {
      const candidate = rawOrder as { order_number?: unknown };
      skipped.push({
        order_number:
          typeof candidate.order_number === 'string' ? candidate.order_number : `#${index + 1}`,
        reason: 'некоректна структура Gmail-експорту',
      });
      return;
    }

    const order = parsed.data;
    if (order.order_history_status === 'cancelled') {
      skipped.push({
        order_number: order.order_number,
        reason: 'замовлення скасоване за історією Amazon',
      });
      return;
    }
    if (order.order_history_status === 'return_started') {
      skipped.push({
        order_number: order.order_number,
        reason: 'за історією Amazon розпочато повернення',
      });
      return;
    }

    const total = parseMoney(order.total);
    const pricedItems = order.items.map((item) => ({ ...item, money: parseMoney(item.price) }));
    if (total.currency !== 'EUR' || pricedItems.some((item) => item.money.currency !== 'EUR')) {
      skipped.push({
        order_number: order.order_number,
        reason: 'валюта позицій або замовлення не EUR',
      });
      return;
    }

    let importTotal = total.amount;
    let importItems = pricedItems;
    if (order.return_info) {
      const refundText = order.return_info.refund_amount;
      const refund = refundText ? parseMoney(refundText) : null;
      const returned = refund
        ? pricedItems.filter(
            (item) =>
              refund.currency === 'EUR' &&
              moneyEquals(item.money.amount * item.quantity, refund.amount),
          )
        : [];
      if (refund?.currency !== 'EUR' || returned.length !== 1) {
        skipped.push({
          order_number: order.order_number,
          reason: 'повернення не можна однозначно зіставити з позицією',
        });
        return;
      }
      importTotal = Math.round((importTotal - refund.amount) * 100) / 100;
      importItems = pricedItems.filter((item) => item !== returned[0]);
      if (importItems.length === 0) {
        skipped.push({ order_number: order.order_number, reason: 'усі позиції повернено' });
        return;
      }
    }

    const itemTotal = importItems.reduce((sum, item) => sum + item.money.amount * item.quantity, 0);
    if (!moneyEquals(importTotal, itemTotal)) {
      skipped.push({
        order_number: order.order_number,
        reason: `сума позицій €${itemTotal.toFixed(2)} не дорівнює витраті €${importTotal.toFixed(2)}`,
      });
      return;
    }

    const localDateTime = berlinDateTime(order.date);

    receipts.push({
      store: 'Amazon',
      store_address: null,
      date: localDateTime.date,
      time: localDateTime.time,
      currency: 'EUR',
      total_orig: importTotal,
      total_raw_text: order.return_info
        ? `${order.total} minus refund ${order.return_info.refund_amount ?? ''}`
        : order.gmail_total
          ? `${order.total} (Gmail total ${order.gmail_total})`
          : order.total,
      article_count: importItems.length,
      article_count_raw_text: null,
      merchant_order_id: order.order_number,
      items: importItems.map((item, itemIndex) => ({
        product_name: item.title,
        product_code: item.asin,
        product_url: trustedAmazonUrl(item.product_link, false),
        product_image_url: trustedAmazonUrl(item.image, true),
        qty: item.quantity,
        unit_price_orig: item.money.amount,
        discount_orig: 0,
        category_suggestion: item.category ?? null,
        row_kind: 'item',
        qty_evidence: item.quantity === 1 ? 'implicit_one' : 'explicit_multiplier',
        source_ordinal: itemIndex + 1,
        raw_text: item.gmail_price ? `${item.price} (Gmail price ${item.gmail_price})` : item.price,
        printed_line_total_orig: item.money.amount * item.quantity,
      })),
    });
  });

  return { receipts, skipped };
}
