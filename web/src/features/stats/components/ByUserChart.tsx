import { useMemo } from 'react';
import { Pie } from 'react-chartjs-2';
import './chart-setup';
import type { StatsByUserRow } from '../api/stats.types';

type Props = {
  rows: StatsByUserRow[];
};

const PALETTE = [
  'rgba(15, 23, 42, 0.85)',
  'rgba(217, 119, 6, 0.85)',
  'rgba(13, 148, 136, 0.85)',
  'rgba(190, 24, 93, 0.85)',
];

export function ByUserChart({ rows }: Props) {
  const data = useMemo(
    () => ({
      labels: rows.map((r) => r.paid_by),
      datasets: [
        {
          data: rows.map((r) => r.total_eur),
          backgroundColor: rows.map((_, i) => PALETTE[i % PALETTE.length] ?? PALETTE[0]),
        },
      ],
    }),
    [rows],
  );

  return (
    <Pie
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
      }}
    />
  );
}
