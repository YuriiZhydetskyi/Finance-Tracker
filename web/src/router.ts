import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { DefaultErrorComponent } from './shared/ui/DefaultErrorComponent';

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultErrorComponent: DefaultErrorComponent,
});

declare module '@tanstack/react-router' {
  // Module augmentation requires `interface` (declaration merging).
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Register {
    router: typeof router;
  }
}
