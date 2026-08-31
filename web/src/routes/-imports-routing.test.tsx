import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { routeTree } from '@/routeTree.gen';

vi.mock('@/features/auth', () => ({
  Header: () => null,
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/features/imports', () => ({
  BulkImportForm: () => <div>New batch form</div>,
  ImportBatchDetail: ({ id }: { id: string }) => <div>Batch detail {id}</div>,
  useImportBatches: () => ({ data: [], isError: false }),
}));

describe('imports routing', () => {
  it('renders batch details instead of the new batch page for /imports/$id', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/imports/batch-123'] }),
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Batch detail batch-123')).toBeInTheDocument();
    expect(screen.queryByText('New batch form')).not.toBeInTheDocument();
  });
});
