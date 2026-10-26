import { useMemo } from 'react';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsByMonthRow } from '../api/stats.types';

type Props = {
  rows: StatsByMonthRow[];
};

const LABEL = 'Стовпчаста діаграма: витрати по місяцях, EUR';

const OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true } },
};

export function ByMonthChart({ rows }: Props) {
  // rows arrive desc; charts read left-to-right chronologically
  const chronological = useMemo(() => [...rows].reverse(), [rows]);

  const data = useMemo(
    () => ({
      labels: chronological.map((r) => r.month),
      datasets: [
        {
          label: '€',
          data: chronological.map((r) => r.total_eur),
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          borderRadius: 4,
        },
      ],
    }),
    [chronological],
  );

  return <Bar data={data} options={OPTIONS} aria-label={LABEL} fallbackContent={LABEL} />;
}
