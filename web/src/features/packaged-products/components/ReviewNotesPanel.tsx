import { useState, type SubmitEvent } from 'react';
import {
  CARD_REVIEW_NOTES_MAX,
  REVIEW_NOTE_MAX_LENGTH,
  normalizeReviewNotes,
} from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';

type Props = Readonly<{
  notes: string[];
  saving: boolean;
  /** Replaces the whole list. A rejection keeps the open editor so nothing typed is lost. */
  onChange: (next: string[]) => Promise<unknown>;
}>;

function NoteForm({
  label,
  submitLabel,
  initial,
  saving,
  onSubmit,
  onCancel,
}: Readonly<{
  label: string;
  submitLabel: string;
  initial: string;
  saving: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}>) {
  const [text, setText] = useState(initial);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() !== '') onSubmit(text);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={label}
        value={text}
        maxLength={REVIEW_NOTE_MAX_LENGTH}
        disabled={saving}
        className="min-w-0 flex-1"
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" disabled={saving || text.trim() === ''}>
        {submitLabel}
      </Button>
      <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
        Скасувати
      </Button>
    </form>
  );
}

/**
 * The reasons a card still needs a manual check (ADR-0030). The card stays usable;
 * ticking a note off removes it, and removing the last one clears the marker.
 */
export function ReviewNotesPanel({ notes, saving, onChange }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const full = notes.length >= CARD_REVIEW_NOTES_MAX;

  const apply = async (next: string[], done: () => void) => {
    try {
      await onChange(normalizeReviewNotes(next));
      done();
    } catch {
      // The parent shows the mutation error; the editor stays open with its text.
    }
  };
  const closeEditors = () => {
    setEditingIndex(null);
    setAdding(false);
  };

  const addForm = (
    <NoteForm
      label="Нова примітка до перевірки"
      submitLabel="Додати"
      initial=""
      saving={saving}
      onSubmit={(text) => void apply([...notes, text], closeEditors)}
      onCancel={() => setAdding(false)}
    />
  );

  if (notes.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        <span>Перевірка не потрібна.</span>
        {adding ? (
          addForm
        ) : (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setAdding(true)}>
            Позначити для перевірки
          </Button>
        )}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="review-notes-title"
      className="rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="review-notes-title" className="text-sm font-semibold text-amber-900">
            Потрібна перевірка
          </h2>
          <p className="mt-0.5 text-xs text-amber-900">
            Картка придатна до використання, але це варто звірити з упаковкою. Позначена перевіреною
            примітка зникає; коли зникне остання, зникне й позначка в каталозі.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={() => void apply([], closeEditors)}
        >
          Позначити все перевіреним
        </Button>
      </div>

      <ul className="mt-3 space-y-2">
        {notes.map((note, index) => (
          <li key={note} className="rounded border border-amber-200 bg-white p-2">
            {editingIndex === index ? (
              <NoteForm
                label="Текст примітки"
                submitLabel="Зберегти"
                initial={note}
                saving={saving}
                onSubmit={(text) =>
                  void apply(
                    notes.map((existing, i) => (i === index ? text : existing)),
                    closeEditors,
                  )
                }
                onCancel={() => setEditingIndex(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 text-sm text-slate-900">{note}</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3"
                  disabled={saving}
                  aria-label={`Перевірено: ${note}`}
                  onClick={() =>
                    void apply(
                      notes.filter((_, i) => i !== index),
                      closeEditors,
                    )
                  }
                >
                  Перевірено
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-3"
                  disabled={saving}
                  aria-label={`Змінити: ${note}`}
                  onClick={() => {
                    setAdding(false);
                    setEditingIndex(index);
                  }}
                >
                  Змінити
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3">
        {adding ? (
          addForm
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={saving || full}
            title={
              full ? `Найбільше ${String(CARD_REVIEW_NOTES_MAX)} приміток на картці` : undefined
            }
            onClick={() => {
              setEditingIndex(null);
              setAdding(true);
            }}
          >
            Додати примітку
          </Button>
        )}
      </div>
    </section>
  );
}
