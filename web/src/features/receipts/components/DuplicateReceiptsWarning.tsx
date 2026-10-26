import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useDuplicateReceipts } from '../api/use-duplicate-receipts';
import type { ManualFormValues } from '../schemas/manual-form';
import { computeGrandTotal } from '../utils/totals';
import { DuplicateWarningBanner } from './DuplicateWarningBanner';

/**
 * Watches the identifying fields of the receipt being entered and warns about a likely duplicate.
 * Subscribing here, instead of in the form component, keeps the item rows from re-rendering on
 * every keystroke.
 */
export function DuplicateReceiptsWarning() {
  const { control } = useFormContext<ManualFormValues>();
  const store = useWatch({ control, name: 'store' });
  const date = useWatch({ control, name: 'date' });
  const time = useWatch({ control, name: 'time' });
  const total = useWatch({
    control,
    name: 'items',
    compute: (items) => computeGrandTotal(items ?? []),
  });
  const [dismissed, setDismissed] = useState(false);
  const duplicatesQuery = useDuplicateReceipts({ store, date, time, total_orig: total });

  return (
    <DuplicateWarningBanner
      candidates={dismissed ? [] : (duplicatesQuery.data ?? [])}
      onDismiss={() => {
        setDismissed(true);
      }}
    />
  );
}
