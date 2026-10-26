import { useState } from 'react';
import { useAppUsers, useCurrentUser } from '@/features/auth';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { Input } from '@/shared/ui/Input';
import { FIELD_LABEL_CLASS, SELECT_CLASS } from '@/shared/ui/select-classes';
import {
  DEFAULT_SENDER_DOMAINS,
  EMAIL_INGEST_URL,
  type EmailImportMessage,
  type EmailImportSource,
  parseSenderDomains,
  useCreateEmailImportSource,
  useEmailImportMessages,
  useEmailImportSources,
  useRetryEmailImportMessage,
  useRevokeEmailImportSource,
  useSetEmailImportSenderDomains,
} from '../api/email-imports';

const SETUP_GUIDE_URL =
  'https://github.com/YuriiZhydetskyi/Finance-Tracker/blob/main/docs/gmail-import.md';
const MAX_ACTIVE_SOURCES = 3;

const SKIP_REASONS: Record<string, string> = {
  before_import_after: 'старіший за дату початку',
  sender_not_allowed: 'домен відправника не в списку дозволених',
  'sender_not_authenticated:fail': 'відправника не підтверджено (DMARC fail)',
  'sender_not_authenticated:unknown': 'відправника не підтверджено (немає DMARC/DKIM)',
  no_receipt_content: 'немає PDF або тексту',
  unparseable_email: 'не вдалося прочитати лист',
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('uk-UA') : '—';
}

function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

export function GmailImportSettings() {
  const sources = useEmailImportSources();
  const messages = useEmailImportMessages();
  const [newToken, setNewToken] = useState<string | null>(null);
  const activeSources = sources.data ?? [];

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Автоімпорт з Gmail</h2>
        <p className="text-sm text-slate-600">
          Скрипт у твоєму Google-акаунті раз на годину надсилає нові листи з однієї мітки. Доступ до
          пошти лишається в Google: застосунок отримує лише листи від дозволених доменів і зберігає
          тільки хеш токена.{' '}
          <a
            href={SETUP_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-900 underline"
          >
            Інструкція з налаштування
          </a>
        </p>
      </div>

      {newToken && <NewTokenNotice token={newToken} onDismiss={() => setNewToken(null)} />}

      {sources.isError && (
        <ErrorDetails error={sources.error} label="Не вдалося завантажити підключення" />
      )}
      {activeSources.map((source) => (
        <SourceCard key={source.id} source={source} />
      ))}
      {sources.isSuccess && activeSources.length < MAX_ACTIVE_SOURCES && (
        <CreateSourceForm onCreated={setNewToken} />
      )}

      <MessageLog messages={messages.data ?? []} error={messages.error} />
    </section>
  );
}

function NewTokenNotice({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  return (
    <div role="status" className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">
        Скопіюй токен зараз: він показується лише один раз. Встав обидва значення у властивості
        скрипта (Project Settings → Script properties).
      </p>
      <CopyField label="INGEST_URL" value={EMAIL_INGEST_URL} />
      <CopyField label="INGEST_TOKEN" value={token} />
      <Button type="button" variant="secondary" onClick={onDismiss}>
        Токен збережено, сховати
      </Button>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-1">
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} className="font-mono text-xs" />
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? 'Скопійовано' : 'Копіювати'}
        </Button>
      </div>
    </div>
  );
}

function CreateSourceForm({ onCreated }: { onCreated: (token: string) => void }) {
  const users = useAppUsers();
  const currentUser = useCurrentUser();
  const create = useCreateEmailImportSource();
  const [payerOverride, setPayerOverride] = useState('');
  const [importAfter, setImportAfter] = useState(todayInputValue);
  const [domains, setDomains] = useState(DEFAULT_SENDER_DOMAINS.join(', '));
  const options = users.data ?? [];
  const paidBy =
    payerOverride ||
    (currentUser.data?.email && options.includes(currentUser.data.email)
      ? currentUser.data.email
      : (options[0] ?? ''));
  const senderDomains = parseSenderDomains(domains);

  const submit = async () => {
    try {
      const token = await create.mutateAsync({
        paidBy,
        importAfter: new Date(`${importAfter}T00:00:00`),
        senderDomains,
      });
      onCreated(token);
    } catch {
      // Shown below through create.error.
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed border-slate-300 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Нове підключення</h3>
      <label className="block space-y-1 text-sm font-medium text-slate-700">
        Хто оплатив чеки з листів
        <select
          className={SELECT_CLASS}
          value={paidBy}
          onChange={(event) => setPayerOverride(event.target.value)}
        >
          {options.map((email) => (
            <option key={email} value={email}>
              {email}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-700">
        Імпортувати листи, отримані з
        <Input
          type="date"
          value={importAfter}
          max={todayInputValue()}
          onChange={(event) => setImportAfter(event.target.value)}
        />
      </label>
      <div className="space-y-1">
        <label className="block space-y-1 text-sm font-medium text-slate-700">
          Дозволені домени відправників
          <Input
            value={domains}
            aria-describedby="email-import-domains-hint"
            onChange={(event) => setDomains(event.target.value)}
          />
        </label>
        <p id="email-import-domains-hint" className="text-xs text-slate-500">
          Через кому. Піддомени входять автоматично: edeka.de охоплює app.edeka.de.
        </p>
      </div>
      {create.isError && <ErrorDetails error={create.error} label="Не вдалося створити токен" />}
      <Button
        type="button"
        disabled={!paidBy || !importAfter || senderDomains.length === 0 || create.isPending}
        onClick={() => void submit()}
      >
        {create.isPending ? 'Створюю…' : 'Створити токен'}
      </Button>
    </div>
  );
}

function SourceCard({ source }: { source: EmailImportSource }) {
  const setDomains = useSetEmailImportSenderDomains();
  const revoke = useRevokeEmailImportSource();
  const [domains, setDomainsInput] = useState(source.allowed_sender_domains.join(', '));
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const senderDomains = parseSenderDomains(domains);

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-medium text-slate-900">Токен …{source.token_hint}</span>
        <span className="text-slate-600">
          Востаннє на зв’язку: {formatDateTime(source.last_used_at)}
        </span>
      </div>
      <p className="text-slate-600">
        Листи з {new Date(source.import_after).toLocaleDateString('uk-UA')} · платник:{' '}
        {source.paid_by}
      </p>
      <div className="flex items-end gap-2">
        <label className="block flex-1 space-y-1 font-medium text-slate-700">
          Дозволені домени відправників
          <Input value={domains} onChange={(event) => setDomainsInput(event.target.value)} />
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={senderDomains.length === 0 || setDomains.isPending}
          onClick={() => setDomains.mutate({ id: source.id, senderDomains })}
        >
          Зберегти
        </Button>
      </div>
      {setDomains.isError && (
        <ErrorDetails error={setDomains.error} label="Не вдалося зберегти домени" />
      )}
      {revoke.isError && <ErrorDetails error={revoke.error} label="Не вдалося відкликати токен" />}
      {confirmRevoke ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-700">Скрипт із цим токеном перестане працювати.</span>
          <Button
            type="button"
            variant="danger"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(source.id)}
          >
            Відкликати
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmRevoke(false)}>
            Скасувати
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setConfirmRevoke(true)}>
          Відкликати токен
        </Button>
      )}
    </div>
  );
}

function MessageLog({ messages, error }: { messages: EmailImportMessage[]; error: Error | null }) {
  const retry = useRetryEmailImportMessage();
  if (error) return <ErrorDetails error={error} label="Не вдалося завантажити журнал листів" />;
  if (messages.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Останні листи</h3>
      {retry.isError && <ErrorDetails error={retry.error} label="Не вдалося повторити" />}
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
        {messages.map((message) => (
          <li key={message.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0 space-y-0.5">
              <p className="truncate font-medium text-slate-900">{message.subject ?? 'Без теми'}</p>
              <p className="truncate text-xs text-slate-500">
                {message.sender ?? 'невідомий відправник'} · {formatDateTime(message.received_at)}
              </p>
            </div>
            {message.status === 'imported' ? (
              <span className="text-xs text-emerald-700">
                у батчі · документів: {message.file_count}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-xs text-amber-700">
                Пропущено: {SKIP_REASONS[message.reason ?? ''] ?? message.reason ?? 'без причини'}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate(message.id)}
                >
                  Повторити
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
