// Chart.js needs scales and elements registered explicitly (tree-shake-friendly).
// Importing this file (top of any chart component) installs the controllers we use.

import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, Title);
