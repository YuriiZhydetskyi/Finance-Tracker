import { Link } from '@tanstack/react-router';
import type { PackagedProductListRow } from '../api/use-packaged-products';

function packageLabel(row: PackagedProductListRow): string | null {
  if (row.package_size == null || row.package_unit == null) return null;
  const unit = { pcs: 'шт', g: 'г', kg: 'кг', ml: 'мл', l: 'л' }[row.package_unit];
  const size = `${String(Number(row.package_size.toFixed(3)))} ${unit}`;
  return row.package_count ? `${String(row.package_count)} × ${size}` : size;
}

type Props = Readonly<{ products: PackagedProductListRow[]; emptyMessage?: string }>;

export function PackagedProductsList({
  products,
  emptyMessage = 'Каталог порожній. Створи першу картку з вкладки «Сфотографувати».',
}: Props) {
  if (products.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {products.map((product) => (
        <li key={product.id} className="rounded-md border border-slate-200 bg-white">
          <Link
            to="/packaged-products/$id"
            params={{ id: product.id }}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-slate-50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{product.name}</p>
              <p className="text-xs text-slate-600">
                {product.category}
                {packageLabel(product) ? ` · ${packageLabel(product) ?? ''}` : ''}
                {product.barcode ? ` · ${product.barcode}` : ' · без штрихкоду'}
              </p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>
                {product.energy_kcal == null
                  ? 'без харчової цінності'
                  : `${String(product.energy_kcal)} ккал / 100${product.nutrition_basis === 'per_100_ml' ? ' мл' : ' г'}`}
              </p>
              <p>
                {product.photos_count} фото · {product.store_labels_count} назв у чеках
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
