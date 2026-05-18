import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsWasteByMonthRow } from '../api/stats.types';

type Props = {
  rows: StatsWasteByMonthRow[];
};

export function WasteByMonthChart({ rows }: Props) {
  const chronological = useMemo(() => [...rows].reverse(), [rows]);

  const data = useMemo(
    () => ({
      labels: chronological.map((r) => r.month),
      datasets: [
        {
          label: '€ викинуто',
          data: chronological.map((r) => r.wasted_value_eur),
          backgroundColor: 'rgba(220, 38, 38, 0.85)',
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
