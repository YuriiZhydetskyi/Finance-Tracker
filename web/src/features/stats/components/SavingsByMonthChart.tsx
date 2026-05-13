import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsSavingsByMonthRow } from '../api/stats.types';

type Props = {
  rows: StatsSavingsByMonthRow[];
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

  return (
    <Bar
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      }}
    />
  );
}
