import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as EmailImports from '../api/email-imports';
import type { EmailImportMessage, EmailImportSource } from '../api/email-imports';
import { GmailImportSettings } from './GmailImportSettings';

const { createMock, retryMock, revokeMock, state } = vi.hoisted(() => ({
  createMock: vi.fn(),
  retryMock: vi.fn(),
  revokeMock: vi.fn(),
  state: {
    sources: [] as EmailImportSource[],
    messages: [] as EmailImportMessage[],
  },
}));

vi.mock('@/features/auth', () => ({
  useCurrentUser: () => ({ data: { email: 'me@example.com' } }),
  useAppUsers: () => ({ data: ['me@example.com', 'partner@example.com'] }),
}));

vi.mock('../api/email-imports', async () => {
  const actual = await vi.importActual<typeof EmailImports>('../api/email-imports');
  const idle = { isPending: false, isError: false, error: null };
  return {
    DEFAULT_SENDER_DOMAINS: ['amazon.de', 'edeka.de'],
    EMAIL_INGEST_URL: 'https://ref.supabase.co/functions/v1/ingest-email-receipts',
    parseSenderDomains: actual.parseSenderDomains,
    useEmailImportSources: () => ({ data: state.sources, isSuccess: true, isError: false }),
    useEmailImportMessages: () => ({ data: state.messages, error: null }),
    useCreateEmailImportSource: () => ({ ...idle, mutateAsync: createMock }),
    useSetEmailImportSenderDomains: () => ({ ...idle, mutate: vi.fn() }),
    useRevokeEmailImportSource: () => ({ ...idle, mutate: revokeMock }),
    useRetryEmailImportMessage: () => ({ ...idle, mutate: retryMock }),
  };
});

vi.mock('@/shared/lib/env', () => ({
  env: { VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_SUPABASE_ANON_KEY: 'x'.repeat(30) },
}));

const SOURCE: EmailImportSource = {
  id: '01SOURCE00000000000000000A',
  owner_email: 'me@example.com',
  paid_by: 'me@example.com',
  token_hint: 'Ab9z',
  allowed_sender_domains: ['amazon.de', 'edeka.de'],
  import_after: '2026-10-26T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
  created_at: '2026-10-26T10:00:00Z',
};

beforeEach(() => {
  state.sources = [];
  state.messages = [];
  createMock.mockReset();
  retryMock.mockReset();
  revokeMock.mockReset();
});

describe('GmailImportSettings', () => {
  it('creates a token with the entered domains and shows it once with the endpoint', async () => {
    createMock.mockResolvedValue('fte_secret-token-value');
    const user = userEvent.setup();
    render(<GmailImportSettings />);

    const domains = screen.getByLabelText('Дозволені домени відправників');
    await user.clear(domains);
    await user.type(domains, 'Amazon.de, uber.com; amazon.de');
    await user.click(screen.getByRole('button', { name: 'Створити токен' }));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paidBy: 'me@example.com',
        senderDomains: ['amazon.de', 'uber.com'],
      }),
    );
    expect(await screen.findByLabelText('INGEST_TOKEN')).toHaveValue('fte_secret-token-value');
    expect(screen.getByLabelText('INGEST_URL')).toHaveValue(
      'https://ref.supabase.co/functions/v1/ingest-email-receipts',
    );

    await user.click(screen.getByRole('button', { name: 'Токен збережено, сховати' }));
    expect(screen.queryByLabelText('INGEST_TOKEN')).not.toBeInTheDocument();
  });

  it('asks for confirmation before revoking a token', async () => {
    state.sources = [SOURCE];
    const user = userEvent.setup();
    render(<GmailImportSettings />);

    expect(screen.getByText('Токен …Ab9z')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Відкликати токен' }));
    expect(revokeMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Відкликати' }));
    expect(revokeMock).toHaveBeenCalledWith(SOURCE.id);
  });

  it('explains why a message was skipped and lets the owner retry it', async () => {
    state.sources = [SOURCE];
    state.messages = [
      {
        id: '01MESSAGE0000000000000000A',
        source_id: SOURCE.id,
        provider_message_id: '19a2',
        received_at: '2026-10-26T13:05:00Z',
        sender: 'noreply@shop.example',
        subject: '<img src=x onerror=alert(1)>',
        status: 'skipped',
        reason: 'sender_not_allowed',
        batch_id: null,
        file_count: 0,
        created_at: '2026-10-26T13:06:00Z',
      },
    ];
    const user = userEvent.setup();
    render(<GmailImportSettings />);

    const row = screen.getByText('<img src=x onerror=alert(1)>').closest('li');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText(/домен відправника не в списку дозволених/),
    ).toBeInTheDocument();
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Повторити' }));
    expect(retryMock).toHaveBeenCalledWith('01MESSAGE0000000000000000A');
  });
});
