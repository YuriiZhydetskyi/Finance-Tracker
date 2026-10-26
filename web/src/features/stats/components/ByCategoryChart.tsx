import { useEffect, useMemo, useRef } from 'react';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsByCategoryRow } from '../api/stats.types';

type Props = Readonly<{
  rows: StatsByCategoryRow[];
  onSelect?: (category: string) => void;
}>;

const LABEL = 'Горизонтальна стовпчаста діаграма: витрати по категоріях, EUR';

export function ByCategoryChart({ rows, onSelect }: Props) {
  const data = useMemo(
    () => ({
      labels: rows.map((r) => r.category),
      datasets: [
        {
          label: '€',
          data: rows.map((r) => r.total_eur),
          backgroundColor: 'rgba(13, 148, 136, 0.85)', // teal
          borderRadius: 4,
        },
      ],
    }),
    [rows],
  );

  // The caller passes a fresh handler every render; reading it through a ref
  // keeps `options` referentially stable so react-chartjs-2 does not call
  // chart.update() on each render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const selectable = onSelect !== undefined;

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      onClick: (_event, elements, chart) => {
        const index = elements[0]?.index;
        const category = index === undefined ? undefined : chart.data.labels?.[index];
        if (typeof category === 'string') onSelectRef.current?.(category);
      },
      onHover: (_event, elements, chart) => {
        chart.canvas.style.cursor = selectable && elements.length > 0 ? 'pointer' : 'default';
      },
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    }),
    [selectable],
  );

  return <Bar data={data} options={options} aria-label={LABEL} fallbackContent={LABEL} />;
}
