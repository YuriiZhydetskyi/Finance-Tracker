type Props = Readonly<{
  checked: boolean;
  /** Cards that currently need a check in the whole catalogue, not just the searched part. */
  count: number;
  onChange: (checked: boolean) => void;
}>;

export function ReviewFilterToggle({ checked, count, onChange }: Props) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Лише потрібна перевірка ({count})
    </label>
  );
}
