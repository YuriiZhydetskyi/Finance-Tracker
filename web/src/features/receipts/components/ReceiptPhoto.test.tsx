import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReceiptPhoto } from './ReceiptPhoto';

const sign = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: { getSignedUrl: (...args: unknown[]) => sign(...args) },
}));

function open(photoPath: string | null, photoUrl: string | null) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ReceiptPhoto photoPath={photoPath} photoUrl={photoUrl} />
    </QueryClientProvider>,
  );
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
