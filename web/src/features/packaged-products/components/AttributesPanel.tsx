import { useId, useState, type SubmitEvent } from 'react';
import {
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_VALUE_MAX_LENGTH,
  CARD_ATTRIBUTES_MAX,
  attributeEntries,
  attributeKeyIdentity,
  normalizeAttributes,
  type ProductAttributes,
} from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/ui/cn';
import { Input } from '@/shared/ui/Input';
import { SUGGESTED_ATTRIBUTE_KEYS } from '../utils/attribute-keys';

type Props = Readonly<{
  attributes: ProductAttributes;
  /** The pre-«Інше» free-text `notes` column. Shown read-only: nothing else displays it. */
  legacyNote: string | null;
  saving: boolean;
  /** Replaces the whole object. A rejection keeps the open editor so nothing typed is lost. */
  onChange: (next: ProductAttributes) => Promise<unknown>;
}>;

type Pair = readonly [key: string, value: string];

function PairForm({
  keyLabel,
  valueLabel,
  submitLabel,
  initialKey,
  initialValue,
  suggestions,
  takenKeys,
  saving,
  onSubmit,
  onCancel,
}: Readonly<{
  keyLabel: string;
  valueLabel: string;
  submitLabel: string;
  initialKey: string;
  initialValue: string;
  /** Datalist id for the key field, or null for no suggestions. */
  suggestions: string | null;
  /** Identities of the keys of the other pairs: a key must stay unique on the card. */
  takenKeys: ReadonlySet<string>;
  saving: boolean;
  onSubmit: (key: string, value: string) => void;
  onCancel: () => void;
}>) {
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState(initialValue);
  const duplicate = takenKeys.has(attributeKeyIdentity(key));
  const blank = key.trim() === '' || value.trim() === '';

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!blank && !duplicate) onSubmit(key, value);
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={keyLabel}
          placeholder="Назва"
          value={key}
          maxLength={ATTRIBUTE_KEY_MAX_LENGTH}
          disabled={saving}
          list={suggestions ?? undefined}
          className="min-w-0 flex-1 basis-40"
          onChange={(event) => setKey(event.target.value)}
        />
        <Input
          aria-label={valueLabel}
          placeholder="Значення"
          value={value}
          maxLength={ATTRIBUTE_VALUE_MAX_LENGTH}
          disabled={saving}
          className="min-w-0 flex-[2] basis-56"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" disabled={saving || blank || duplicate}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          Скасувати
        </Button>
      </div>
      {duplicate ? (
        <p role="alert" className="text-xs text-red-700">
          Така назва вже є на картці. Зміни її значення замість додавання нової.
        </p>
      ) : null}
    </form>
  );
}

/**
 * «Інше» (ADR-0035): label facts without a column of their own, such as variety,
 * calibre, class, origin. Names are unique on a card ignoring case; the order shown
 * is alphabetical because jsonb does not keep the order they were entered in.
 */
export function AttributesPanel({ attributes, legacyNote, saving, onChange }: Props) {
  const datalistId = useId();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const entries = attributeEntries(attributes);
  const full = entries.length >= CARD_ATTRIBUTES_MAX;

  const apply = async (next: readonly Pair[], done: () => void) => {
    try {
      await onChange(normalizeAttributes(Object.fromEntries(next)));
      done();
    } catch {
      // The parent shows the mutation error; the editor stays open with its text.
    }
  };
  const closeEditors = () => {
    setEditingKey(null);
    setAdding(false);
  };
  const keysExcept = (key: string | null): ReadonlySet<string> =>
    new Set(
      entries
        .filter(([existing]) => existing !== key)
        .map(([existing]) => attributeKeyIdentity(existing)),
    );

  return (
    <section
      aria-labelledby="attributes-title"
      className="rounded-md border border-slate-200 bg-white p-4"
    >
      <h2 id="attributes-title" className="mb-1 text-sm font-semibold text-slate-900">
        Інше
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Те, що надруковано на етикетці й не має окремого поля: сорт, калібр, клас, походження,
        виробник, умови зберігання.
      </p>

      {legacyNote ? (
        <dl className="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 text-sm">
          <dt className="text-slate-600">Примітка</dt>
          <dd className="whitespace-pre-line text-slate-900">{legacyNote}</dd>
        </dl>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">Нічого не внесено.</p>
      ) : (
        <dl className="divide-y divide-slate-100 text-sm">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className={cn(
                'py-2 first:pt-0 last:pb-0',
                editingKey !== key && 'flex flex-wrap items-center gap-x-3 gap-y-1',
              )}
            >
              {editingKey === key ? (
                <>
                  <dt className="sr-only">{key}</dt>
                  <dd>
                    <PairForm
                      keyLabel="Назва пункту"
                      valueLabel="Значення пункту"
                      submitLabel="Зберегти"
                      initialKey={key}
                      initialValue={value}
                      suggestions={datalistId}
                      takenKeys={keysExcept(key)}
                      saving={saving}
                      onSubmit={(nextKey, nextValue) =>
                        void apply(
                          entries.map(([existing, current]): Pair =>
                            existing === key ? [nextKey, nextValue] : [existing, current],
                          ),
                          closeEditors,
                        )
                      }
                      onCancel={() => setEditingKey(null)}
                    />
                  </dd>
                </>
              ) : (
                <>
                  <dt className="w-44 shrink-0 text-slate-600">{key}</dt>
                  <dd className="min-w-0 flex-1 text-slate-900">{value}</dd>
                  <dd className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-3"
                      disabled={saving}
                      aria-label={`Змінити: ${key}`}
                      onClick={() => {
                        setAdding(false);
                        setEditingKey(key);
                      }}
                    >
                      Змінити
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-3"
                      disabled={saving}
                      aria-label={`Видалити: ${key}`}
                      onClick={() =>
                        void apply(
                          entries.filter(([existing]) => existing !== key),
                          closeEditors,
                        )
                      }
                    >
                      Видалити
                    </Button>
                  </dd>
                </>
              )}
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3">
        {adding ? (
          <PairForm
            keyLabel="Нова назва"
            valueLabel="Нове значення"
            submitLabel="Додати"
            initialKey=""
            initialValue=""
            suggestions={datalistId}
            takenKeys={keysExcept(null)}
            saving={saving}
            onSubmit={(key, value) => void apply([...entries, [key, value]], closeEditors)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={saving || full}
            title={full ? `Найбільше ${String(CARD_ATTRIBUTES_MAX)} пунктів на картці` : undefined}
            onClick={() => {
              setEditingKey(null);
              setAdding(true);
            }}
          >
            Додати пункт
          </Button>
        )}
      </div>

      <datalist id={datalistId}>
        {SUGGESTED_ATTRIBUTE_KEYS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </section>
  );
}
