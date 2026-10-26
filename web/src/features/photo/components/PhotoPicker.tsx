import { useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { useObjectUrl } from '@/shared/hooks/use-object-url';

type Props = {
  onPicked: (files: File[]) => void;
  disabled?: boolean;
};

function isPreviewableImage(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  if (t === 'application/pdf') return false;
  if (/\.(heic|heif|pdf)$/i.test(file.name)) return false;
  return t.startsWith('image/');
}

export function PhotoPicker({ onPicked, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const previewUrl = useObjectUrl(previewFile);
  const [pickedCount, setPickedCount] = useState(0);
  const [pickedName, setPickedName] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPickedCount(files.length);
    if (files.length === 1) {
      const only = files[0]!;
      setPickedName(only.name || null);
      setPreviewFile(isPreviewableImage(only) ? only : null);
    } else {
      setPickedName(null);
      setPreviewFile(null);
    }
    onPicked(files);
  }

  function reset() {
    setPreviewFile(null);
    setPickedCount(0);
    setPickedName(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.heic,.heif"
        multiple
        onChange={handleChange}
        disabled={disabled}
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800 disabled:opacity-50"
      />
      {previewFile ? (
        <div className="space-y-2">
          <img
            src={previewUrl ?? undefined}
            alt="Прев'ю чека"
            className="max-h-72 w-auto rounded-md border border-slate-200 object-contain"
          />
          <Button variant="ghost" type="button" onClick={reset} disabled={disabled}>
            Вибрати інше
          </Button>
        </div>
      ) : pickedCount === 1 && pickedName ? (
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <span
            aria-hidden
            className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs uppercase text-slate-700"
          >
            PDF
          </span>
          <span className="truncate">{pickedName}</span>
          <Button variant="ghost" type="button" onClick={reset} disabled={disabled}>
            Вибрати інше
          </Button>
        </div>
      ) : pickedCount > 1 ? (
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <span>Вибрано файлів: {pickedCount}</span>
          <Button variant="ghost" type="button" onClick={reset} disabled={disabled}>
            Скинути
          </Button>
        </div>
      ) : null}
    </div>
  );
}
