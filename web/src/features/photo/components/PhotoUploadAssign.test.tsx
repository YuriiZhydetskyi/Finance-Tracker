import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhotoUploadAssign } from './PhotoUploadAssign';

// useCurrentUser / useAppUsers are mocked so the component renders without a
// QueryClient; the hoisted refs let each test set the auth state.
const auth = vi.hoisted(() => ({
  user: undefined as { email: string } | undefined,
  appUsers: [] as string[],
}));

vi.mock('@/features/auth', () => ({
  useCurrentUser: () => ({ data: auth.user }),
  useAppUsers: () => ({ data: auth.appUsers }),
}));

beforeEach(() => {
  auth.user = undefined;
  auth.appUsers = [];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('PhotoUploadAssign', () => {
  it('defaults every photo to the current user and confirms that payer', () => {
    auth.user = { email: 'me@example.com' };
    auth.appUsers = ['me@example.com', 'her@example.com'];
    const onConfirm = vi.fn();
    const files = [makeFile('a.jpg'), makeFile('b.jpg')];

    render(<PhotoUploadAssign files={files} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Почати розпізнавання' }));

    expect(onConfirm).toHaveBeenCalledWith([
      { file: files[0], paidBy: 'me@example.com' },
      { file: files[1], paidBy: 'me@example.com' },
    ]);
  });

  it('falls back to the first allowlisted email when the current user is not allowlisted', () => {
    auth.user = { email: 'stranger@example.com' };
    auth.appUsers = ['her@example.com', 'me@example.com'];
    const onConfirm = vi.fn();
    const files = [makeFile('a.jpg')];

    render(<PhotoUploadAssign files={files} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Почати розпізнавання' }));

    expect(onConfirm).toHaveBeenCalledWith([{ file: files[0], paidBy: 'her@example.com' }]);
  });

  it('applies a per-photo override only to that photo', () => {
    auth.user = { email: 'me@example.com' };
    auth.appUsers = ['me@example.com', 'her@example.com'];
    const onConfirm = vi.fn();
    const files = [makeFile('a.jpg'), makeFile('b.jpg')];

    render(<PhotoUploadAssign files={files} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Хто оплатив: b.jpg'), {
      target: { value: 'her@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Почати розпізнавання' }));

    expect(onConfirm).toHaveBeenCalledWith([
      { file: files[0], paidBy: 'me@example.com' },
      { file: files[1], paidBy: 'her@example.com' },
    ]);
  });

  it('disables confirm when the allowlist is empty (no payer to assign)', () => {
    auth.user = undefined;
    auth.appUsers = [];

    render(
      <PhotoUploadAssign files={[makeFile('a.jpg')]} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Почати розпізнавання' })).toBeDisabled();
  });
});
