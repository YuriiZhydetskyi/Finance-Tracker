import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoPicker } from './PhotoPicker';

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob://stub');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('PhotoPicker', () => {
  it('calls onPicked once with all selected files when multiple are picked', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn<(files: File[]) => void>();
    const { container } = render(<PhotoPicker onPicked={onPicked} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]);
    expect(onPicked).toHaveBeenCalledTimes(1);
    const passed = onPicked.mock.calls[0]![0];
    expect(passed).toHaveLength(3);
    expect(passed.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('shows multi-file count label when more than one file is picked', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn();
    const { container } = render(<PhotoPicker onPicked={onPicked} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [makeFile('a.jpg'), makeFile('b.jpg')]);
    expect(screen.getByText(/Вибрано 2 фото/)).toBeInTheDocument();
  });

  it('shows preview image for a single picked file', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn();
    const { container } = render(<PhotoPicker onPicked={onPicked} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, makeFile('a.jpg'));
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('blob://stub');
  });

  it('input has multiple attribute', () => {
    const { container } = render(<PhotoPicker onPicked={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute('multiple');
  });
});
