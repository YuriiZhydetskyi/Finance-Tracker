type Props = Readonly<{ notes: readonly string[] }>;

/** Compact marker for the catalogue list; the reasons themselves live on the detail page. */
export function NeedsReviewBadge({ notes }: Props) {
  return (
    <span
      title={notes.join('\n')}
      className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-300"
    >
      Потрібна перевірка{notes.length > 1 ? ` · ${String(notes.length)}` : ''}
    </span>
  );
}
