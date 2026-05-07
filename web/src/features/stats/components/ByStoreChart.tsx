import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsByStoreRow } from '../api/stats.types';

type Props = {
  rows: StatsByStoreRow[];
};

export function ByStoreChart({ rows }: Props) {
  const data = useMemo(
    () => ({
      labels: rows.map((r) => r.store),
      datasets: [
        {
          label: '€',
          data: rows.map((r) => r.total_eur),
          backgroundColor: 'rgba(190, 24, 93, 0.85)', // pink
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
