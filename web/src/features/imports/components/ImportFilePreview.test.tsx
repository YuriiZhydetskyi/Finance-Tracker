import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportFilePreview } from './ImportFilePreview';

const { getSignedUrlMock } = vi.hoisted(() => ({ getSignedUrlMock: vi.fn() }));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: { getSignedUrl: getSignedUrlMock },
}));

beforeEach(() => {
  getSignedUrlMock.mockReset();
});

describe('ImportFilePreview', () => {
  it('shows an image inline using a short-lived signed URL', async () => {
    getSignedUrlMock.mockResolvedValue('https://storage.test/signed-image');
    const user = userEvent.setup();

    render(
      <ImportFilePreview
        file={{
          mime_type: 'image/jpeg',
          original_filename: 'receipt.jpg',
          storage_path: 'user/imports/batch/receipt.jpg',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Переглянути оригінал' }));

    expect(getSignedUrlMock).toHaveBeenCalledWith('user/imports/batch/receipt.jpg', 600);
    expect(await screen.findByAltText('Оригінал receipt.jpg')).toHaveAttribute(
      'src',
      'https://storage.test/signed-image',
    );
  });

  it('opens a PDF in a new tab after signing it', async () => {
    getSignedUrlMock.mockResolvedValue('https://storage.test/signed-pdf');
    const replace = vi.fn();
    const popup = {
      opener: window,
      location: { replace },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const user = userEvent.setup();

    render(
      <ImportFilePreview
        file={{
          mime_type: 'application/pdf',
          original_filename: 'receipt.pdf',
          storage_path: 'user/imports/batch/receipt.pdf',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Відкрити PDF' }));

    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://storage.test/signed-pdf'));
    expect(popup.opener).toBeNull();
  });

  it('explains when the original was not uploaded', () => {
    render(
      <ImportFilePreview
        file={{ mime_type: 'image/jpeg', original_filename: 'duplicate.jpg', storage_path: null }}
      />,
    );

    expect(screen.getByText('Оригінальний файл недоступний.')).toBeInTheDocument();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});
