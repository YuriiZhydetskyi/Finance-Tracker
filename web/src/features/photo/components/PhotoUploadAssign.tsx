import { useEffect, useMemo, useState } from 'react';
import { useAppUsers, useCurrentUser } from '@/features/auth';
import { Button } from '@/shared/ui/Button';
import { SELECT_CLASS } from '@/shared/ui/select-classes';
import type { AddFileInput } from '../batch/use-batch-parser';

type Props = {
  files: File[];
  onConfirm: (inputs: AddFileInput[]) => void;
  onCancel: () => void;
};

function isPreviewableImage(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  if (t === 'application/pdf') return false;
  if (/\.(heic|heif|pdf)$/i.test(file.name)) return false;
  return t.startsWith('image/');
}

/**
 * Between picking files and parsing: capture WHO PAID for each photo up-front,
 * so a failed parse can be queued with the payer already known (no guessing a
 * week later). Defaults every photo to the current user — usually one tap.
 */
export function PhotoUploadAssign({ files, onConfirm, onCancel }: Props) {
  const { data: user } = useCurrentUser();
  const appUsersQuery = useAppUsers();
  const options = useMemo(() => appUsersQuery.data ?? [], [appUsersQuery.data]);

  const defaultPayer =
    user?.email && options.includes(user.email) ? user.email : (options[0] ?? '');

  // Only explicit per-photo overrides; the effective payer is override ?? default.
  // Keeping defaults out of state avoids a setState-in-effect once the allowlist
  // loads — we just read `defaultPayer` at render time.
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  const previews = useMemo(
    () => files.map((f) => (isPreviewableImage(f) ? URL.createObjectURL(f) : null)),
    [files],
  );
  useEffect(() => {
    return () => {
      for (const url of previews) if (url) URL.revokeObjectURL(url);
    };
  }, [previews]);

  const ready = defaultPayer !== '';

  const handleConfirm = () => {
    onConfirm(files.map((file, i) => ({ file, paidBy: overrides[i] ?? defaultPayer })));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Хто оплатив?</h2>
        <p className="text-sm text-slate-600">
          Вибери платника для кожного фото. Це збережеться навіть якщо розпізнавання впаде — і не
          доведеться згадувати потім.
        </p>
      </div>

      <ul className="space-y-2">
        {files.map((file, i) => {
          const preview = previews[i];
          return (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3"
            >
              {preview ? (
                <img
                  src={preview}
                  alt={file.name}
                  className="h-14 w-14 shrink-0 rounded-md border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
                  <span className="font-mono text-xs uppercase text-slate-500">PDF</span>
                </div>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                {file.name || `Фото ${i + 1}`}
              </span>
              <select
                className={`${SELECT_CLASS} w-auto`}
                aria-label={`Хто оплатив: ${file.name || `фото ${i + 1}`}`}
                value={overrides[i] ?? defaultPayer}
                onChange={(e) => {
                  const value = e.target.value;
                  setOverrides((prev) => ({ ...prev, [i]: value }));
                }}
              >
                {options.map((email) => (
                  <option key={email} value={email}>
                    {email}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleConfirm} disabled={!ready}>
          Почати розпізнавання
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Скасувати
        </Button>
      </div>
    </div>
  );
}
