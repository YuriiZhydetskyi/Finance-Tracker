import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiptPhoto } from './ReceiptPhoto';
import { renderWithQueryClient } from '@/test/query-client';

const sign = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: { getSignedUrl: (...args: unknown[]) => sign(...args) },
}));

function open(photoPath: string | null, photoUrl: string | null) {
  return renderWithQueryClient(<ReceiptPhoto photoPath={photoPath} photoUrl={photoUrl} />);
}

describe('receipt original photo', () => {
  beforeEach(() => sign.mockReset());
  it('signs the retained file only on demand instead of using an expired stored URL', async () => {
    sign.mockResolvedValue('https://example.com/fresh');
    open('receipts/original.jpg', 'https://example.com/expired');
    expect(sign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Показати фото оригіналу чека' }));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'https://example.com/fresh');
    expect(sign).toHaveBeenCalledWith('receipts/original.jpg');
  });
  it('links PDF and email-text originals instead of rendering them as an image', async () => {
    sign.mockResolvedValue('https://example.com/email.txt');
    open('me@example.com/email/source/file.txt', null);
    const link = await screen.findByRole('link', { name: 'Відкрити оригінал (текст листа)' });
    expect(link).toHaveAttribute('href', 'https://example.com/email.txt');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('explains missing and inaccessible originals', async () => {
    const missing = open(null, null);
    expect(screen.getByText('Фото оригіналу для цього чека не збережено.')).toBeInTheDocument();
    missing.unmount();
    open(null, 'https://example.com/expired');
    await userEvent.click(screen.getByRole('button', { name: 'Показати фото оригіналу чека' }));
    fireEvent.error(await screen.findByRole('img'));
    expect(screen.getByRole('alert')).toHaveTextContent('Фото недоступне');
  });
});
