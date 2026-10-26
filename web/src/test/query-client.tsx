import { useState, type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** `wrapper` for `renderHook`/`render`; every mounted wrapper gets its own fresh client. */
export function QueryClientWrapper({ children }: { children: ReactNode }) {
  const [client] = useState(createTestQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function renderWithQueryClient(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: QueryClientWrapper });
}
