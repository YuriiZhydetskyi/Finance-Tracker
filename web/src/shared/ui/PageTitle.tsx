const APP_NAME = 'Finance Tracker';

// React 19 hoists <title> into <head>; unmounting it restores the static
// index.html title.
export function PageTitle({ children }: Readonly<{ children: string }>) {
  return <title>{`${children} — ${APP_NAME}`}</title>;
}
