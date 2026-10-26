import { useMemo } from 'react';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsSavingsByMonthRow } from '../api/stats.types';

type Props = {
  rows: StatsSavingsByMonthRow[];
};

const LABEL = 'Стовпчаста діаграма: заощадження на знижках по місяцях, EUR';

const OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true } },
};

export function SavingsByMonthChart({ rows }: Props) {
  const chronological = useMemo(() => [...rows].reverse(), [rows]);

  const data = useMemo(
    () => ({
      labels: chronological.map((r) => r.month),
      datasets: [
        {
          label: '€ заощаджено',
          data: chronological.map((r) => r.savings_eur),
          backgroundColor: 'rgba(5, 150, 105, 0.85)',
          borderRadius: 4,
        },
      ],
    }),
    [chronological],
  );

  return <Bar data={data} options={OPTIONS} aria-label={LABEL} fallbackContent={LABEL} />;
}
