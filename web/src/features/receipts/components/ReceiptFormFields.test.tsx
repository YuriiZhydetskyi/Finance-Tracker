import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { ReceiptFormFields } from './ReceiptFormFields';
import { emptyItemRow } from '../hooks/use-receipt-form';
import type { ManualFormValues } from '../schemas/manual-form';

function Wrapper() {
  const methods = useForm<ManualFormValues>({
    defaultValues: {
      date: '2026-05-08',
      time: null,
      store: 'Edeka',
      store_address: null,
      currency: 'EUR',
      paid_by: 'mg@example.com',
      source: 'manual',
      note: null,
      photo_url: null,
      raw_ocr_json: null,
      items: [emptyItemRow()],
    },
  });
  const itemsArray = useFieldArray({ control: methods.control, name: 'items' });
  return (
    <FormProvider {...methods}>
      <ReceiptFormFields
        itemsArray={itemsArray}
        categories={['Бакалія']}
        productNames={[]}
        taxonomy={{ families: [], variants: [] }}
        paidByOptions={['mg@example.com']}
        actions={null}
      />
    </FormProvider>
  );
}

describe('ReceiptFormFields — label association', () => {
  it.each([
    ['Дата', 'date'],
    ['Час (опц.)', 'time'],
    ['Магазин / опис', 'store'],
    ['Валюта', 'currency'],
    ['Оплатив', 'paid_by'],
    ['Адреса магазину (опц.)', 'store_address'],
    ['Нотатка (опц.)', 'note'],
  ])('label "%s" is bound to the %s control', (label, field) => {
    render(<Wrapper />);
    expect(screen.getByLabelText(label)).toHaveAttribute('name', field);
  });

  it('focuses the control when its label is clicked', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);

    await user.click(screen.getByText('Магазин / опис'));

    expect(screen.getByLabelText('Магазин / опис')).toHaveFocus();
  });

  it('tells the receipt note apart from the item note', () => {
    render(<Wrapper />);
    expect(screen.getByLabelText('Нотатка (опц.)')).toHaveAttribute('name', 'note');
    expect(screen.getByLabelText('Нотатка')).toHaveAttribute('name', 'items.0.note');
  });
});
