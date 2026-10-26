import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalDialog } from './use-modal-dialog';

function TestDialog({ open }: Readonly<{ open: boolean }>) {
  const ref = useModalDialog(open);
  return <dialog ref={ref}>content</dialog>;
}

function getDialog(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog');
  if (!dialog) throw new Error('dialog not rendered');
  return dialog;
}

describe('useModalDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays closed while open is false', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const { container } = render(<TestDialog open={false} />);

    expect(getDialog(container).open).toBe(false);
    expect(showModal).not.toHaveBeenCalled();
  });

  it('opens the dialog modally when open is true on mount', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const { container } = render(<TestDialog open />);

    expect(getDialog(container).open).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('follows the open flag across rerenders', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    const { container, rerender } = render(<TestDialog open={false} />);
    const dialog = getDialog(container);

    rerender(<TestDialog open />);
    expect(dialog.open).toBe(true);

    rerender(<TestDialog open />);
    expect(showModal).toHaveBeenCalledTimes(1);

    rerender(<TestDialog open={false} />);
    expect(dialog.open).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('ends up open after the StrictMode effect double-invocation', () => {
    const { container } = render(
      <StrictMode>
        <TestDialog open />
      </StrictMode>,
    );

    expect(getDialog(container).open).toBe(true);
  });

  it('closes an open dialog when the component unmounts', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    const { container, unmount } = render(<TestDialog open />);
    const dialog = getDialog(container);

    unmount();

    expect(close).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(false);
  });
});
