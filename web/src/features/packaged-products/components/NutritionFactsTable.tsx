import { NUTRIENT_GRAM_KEYS, type NutrientGramKey } from '@finance-tracker/domain';
import type { PackagedProductRow } from '../types';

const GRAM_LABELS: Record<NutrientGramKey, string> = {
  fat_g: 'Жири',
  saturated_fat_g: 'з них насичені',
  carbohydrate_g: 'Вуглеводи',
  sugars_g: 'з них цукри',
  fibre_g: 'Клітковина',
  protein_g: 'Білки',
  salt_g: 'Сіль',
};

const INDENTED = new Set<NutrientGramKey>(['saturated_fat_g', 'sugars_g']);

function formatGrams(value: number | null): string {
  if (value == null) return '—';
  // Trailing zeros hide the precision the label actually printed.
  return `${String(Number(value.toFixed(3)))} г`;
}

type Props = Readonly<{ product: PackagedProductRow }>;

export function NutritionFactsTable({ product }: Props) {
  if (product.nutrition_basis == null) {
    return (
      <p className="text-sm text-slate-500">
        Харчову цінність не внесено. {product.notes ? `Примітка: ${product.notes}` : ''}
      </p>
    );
  }

  const basisLabel = product.nutrition_basis === 'per_100_g' ? 'на 100 г' : 'на 100 мл';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="pb-2 text-left text-xs text-slate-500">
          Значення {basisLabel}, як надруковано на упаковці
        </caption>
        <tbody className="divide-y divide-slate-100">
          <tr>
            <th scope="row" className="py-1.5 text-left font-medium text-slate-800">
              Енергетична цінність
            </th>
            <td className="py-1.5 text-right tabular-nums text-slate-900">
              {product.energy_kcal == null ? '—' : `${String(product.energy_kcal)} ккал`}
              {product.energy_kj == null ? '' : ` / ${String(product.energy_kj)} кДж`}
            </td>
          </tr>
          {NUTRIENT_GRAM_KEYS.map((key) => (
            <tr key={key}>
              <th
                scope="row"
                className={`py-1.5 text-left font-medium text-slate-800 ${INDENTED.has(key) ? 'pl-4 font-normal text-slate-600' : ''}`}
              >
                {GRAM_LABELS[key]}
              </th>
              <td className="py-1.5 text-right tabular-nums text-slate-900">
                {formatGrams(product[key])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
