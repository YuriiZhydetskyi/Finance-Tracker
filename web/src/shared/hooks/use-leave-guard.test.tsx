import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { UNSAVED_CHANGES_MESSAGE, useLeaveGuard } from './use-leave-guard';

function GuardedPage({ active }: { active: boolean }) {
  useLeaveGuard(active);
  return <p>Form page</p>;
}

function openGuardedPage(active: boolean) {
  const rootRoute = createRootRoute({ component: Outlet });
  const formRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/form',
    component: () => <GuardedPage active={active} />,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/other',
    component: () => <p>Other page</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([formRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: ['/form'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

type TestRouter = ReturnType<typeof openGuardedPage>;

// The app's registered route types do not know this test router's paths. A blocked
// navigation never settles, so it is started without awaiting it.
function goTo(router: TestRouter, options: { ignoreBlocker?: boolean } = {}) {
  void router.navigate({ to: '/other', ...options } as never);
}

describe('useLeaveGuard', () => {
  const confirmSpy = vi.spyOn(window, 'confirm');

  beforeEach(() => {
    confirmSpy.mockReset();
  });

  it('lets navigation through without asking while inactive', async () => {
    const router = openGuardedPage(false);
    await screen.findByText('Form page');

    act(() => goTo(router));

    expect(await screen.findByText('Other page')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('keeps the user on the page when they decline to leave', async () => {
    confirmSpy.mockReturnValue(false);
    const router = openGuardedPage(true);
    await screen.findByText('Form page');

    act(() => goTo(router));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE));
    expect(screen.getByText('Form page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/form');
  });

  it('navigates once the user confirms leaving', async () => {
    confirmSpy.mockReturnValue(true);
    const router = openGuardedPage(true);
    await screen.findByText('Form page');

    act(() => goTo(router));

    expect(await screen.findByText('Other page')).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('skips the prompt for the navigation that finishes the work', async () => {
    const router = openGuardedPage(true);
    await screen.findByText('Form page');

    act(() => goTo(router, { ignoreBlocker: true }));

    expect(await screen.findByText('Other page')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
