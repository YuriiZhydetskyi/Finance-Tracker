import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';

type Props = {
  onPicked: (file: File) => void;
  disabled?: boolean;
};

export function PhotoPicker({ onPicked, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    onPicked(file);
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        disabled={disabled}
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800 disabled:opacity-50"
      />
      {previewUrl ? (
        <div className="space-y-2">
          <img
            src={previewUrl}
            alt="Прев'ю чека"
            className="max-h-72 w-auto rounded-md border border-slate-200 object-contain"
          />
          <Button variant="ghost" type="button" onClick={reset} disabled={disabled}>
            Вибрати інше
          </Button>
        </div>
      ) : null}
    </div>
  );
}
