import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { todayIso } from '@finance-tracker/domain';
import { useCurrentUser } from '@/features/auth';
import {
  ManualFormSchema,
  type ItemFormValues,
  type ManualFormValues,
} from '../schemas/manual-form';

export function emptyItemRow(): ItemFormValues {
  return {
    product_id: null,
    product_name: '',
    store_product_code: null,
    category: '',
    qty: 1,
    unit_price_orig: 0,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    wasted_at: null,
    discount_orig: 0,
  };
}

/**
 * Wraps react-hook-form + Zod resolver + useFieldArray for the items list.
 * Defaults: today (Berlin TZ), EUR, current user's email, single empty row,
 * source='manual'. Override via `initial` for edit flows.
 */
export function useReceiptForm(initial?: Partial<ManualFormValues>) {
  const { data: user } = useCurrentUser();

  const methods = useForm<ManualFormValues>({
    resolver: zodResolver(ManualFormSchema),
    mode: 'onTouched',
    defaultValues: {
      date: todayIso(),
      time: null,
      store: '',
      store_address: null,
      currency: 'EUR',
      paid_by: user?.email ?? '',
      source: 'manual',
      note: null,
      photo_url: null,
      raw_ocr_json: null,
      items: [emptyItemRow()],
      ...initial,
    },
  });

  const itemsArray = useFieldArray({ control: methods.control, name: 'items' });

  return { methods, itemsArray };
}
