import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsByCategoryRow } from '../api/stats.types';

type Props = {
  rows: StatsByCategoryRow[];
};

export function ByCategoryChart({ rows }: Props) {
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

  return (
    <Bar
      data={data}
      options={{
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } },
      }}
    />
  );
}
