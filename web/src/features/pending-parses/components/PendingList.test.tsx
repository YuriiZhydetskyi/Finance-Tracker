import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PendingList } from './PendingList';
import type { PendingParseRow } from '../api/use-pending-parses';

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: {
    getSignedUrl: vi.fn().mockResolvedValue('https://signed/x'),
    upload: vi.fn(),
    remove: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const rows: PendingParseRow[] = [
  {
    id: 'PP-1',
    photo_path: 'me@example.com/2026/06/a.jpg',
    paid_by: 'me@example.com',
    error_message: 'parse-receipt returned invalid shape',
    attempts: 2,
    original_filename: 'aldi.jpg',
    created_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 'PP-2',
    photo_path: 'me@example.com/2026/06/b.pdf',
    paid_by: 'her@example.com',
    error_message: null,
    attempts: 0,
    original_filename: 'lidl.pdf',
    created_at: '2026-06-02T10:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PendingList', () => {
  function setup(overrides: Partial<Parameters<typeof PendingList>[0]> = {}) {
    const props = {
      rows,
      onReparseAll: vi.fn(),
      onReparseOne: vi.fn(),
      onDiscard: vi.fn(),
      isPreparing: false,
      discardingId: null,
      ...overrides,
    };
    render(<PendingList {...props} />, { wrapper });
    return props;
  }

  it('renders the count, payers, error message and per-row actions', () => {
    setup();
    expect(screen.getByText(/2 чеків чекають/)).toBeInTheDocument();
    expect(screen.getByText('aldi.jpg')).toBeInTheDocument();
    expect(screen.getByText(/parse-receipt returned invalid shape/)).toBeInTheDocument();
    expect(screen.getByText(/Оплатив: me@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/Оплатив: her@example.com/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Розпарсити' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Відкинути' })).toHaveLength(2);
  });

  it('"Розпарсити всі" calls onReparseAll', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Розпарсити всі' }));
    expect(props.onReparseAll).toHaveBeenCalledTimes(1);
  });

  it('per-row "Розпарсити" calls onReparseOne with that row', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getAllByRole('button', { name: 'Розпарсити' })[0]!);
    expect(props.onReparseOne).toHaveBeenCalledWith(rows[0]);
  });

  it('"Відкинути" calls onDiscard with that row', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getAllByRole('button', { name: 'Відкинути' })[1]!);
    expect(props.onDiscard).toHaveBeenCalledWith(rows[1]);
  });

  it('disables reparse controls while preparing', () => {
    setup({ isPreparing: true });
    expect(screen.getByRole('button', { name: 'Готую...' })).toBeDisabled();
  });
});
