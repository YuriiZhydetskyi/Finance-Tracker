import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsByMonthRow } from '../api/stats.types';

type Props = {
  rows: StatsByMonthRow[];
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
