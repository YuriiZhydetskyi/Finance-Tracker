import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { DefaultNotFoundComponent } from './DefaultNotFoundComponent';

describe('DefaultNotFoundComponent', () => {
  it('is what the router shows for an unknown address, with a way home', async () => {
    const rootRoute = createRootRoute({ component: Outlet });
    const home = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <p>Home page</p>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([home]),
      defaultNotFoundComponent: DefaultNotFoundComponent,
      history: createMemoryHistory({ initialEntries: ['/no-such-page'] }),
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Сторінку не знайдено')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'На головну' })).toHaveAttribute('href', '/');
  });
});
