import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import './chart-setup';
import type { StatsByCategoryRow } from '../api/stats.types';

type Props = {
  rows: StatsByCategoryRow[];
  onSelect?: (category: string) => void;
};

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

  return (
    <Bar
      data={data}
      options={{
        onClick: (_event, elements) => {
          const index = elements[0]?.index;
          const row = index === undefined ? undefined : rows[index];
          if (row) onSelect?.(row.category);
        },
        onHover: (_event, elements, chart) => {
          chart.canvas.style.cursor = onSelect && elements.length > 0 ? 'pointer' : 'default';
        },
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } },
      }}
    />
  );
}
