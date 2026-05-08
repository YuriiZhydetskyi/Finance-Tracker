import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { useCategories } from '../api/use-categories';
import { useCreateCategoryMutation } from '../api/use-create-category-mutation';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
};

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900';

const FIELD_LABEL_CLASS = 'text-xs font-medium text-slate-600';

const NEW_GROUP_VALUE = '__new__';

export function CreateCategoryDialog({ open, onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const categoriesQuery = useCategories();
  const createMutation = useCreateCategoryMutation();

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const c of categoriesQuery.data ?? []) set.add(c.group_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'uk'));
  }, [categoriesQuery.data]);

  const [name, setName] = useState('');
  const [groupChoice, setGroupChoice] = useState<string>(() => groups[0] ?? NEW_GROUP_VALUE);
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const isCreatingNewGroup = groupChoice === NEW_GROUP_VALUE;
  const pending = createMutation.isPending;

  const handleSubmit = () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Введи назву категорії');
      return;
    }
    const groupValue = isCreatingNewGroup ? newGroupName.trim() : groupChoice;
    if (!groupValue) {
      setError('Введи назву групи');
      return;
    }

    const existing = (categoriesQuery.data ?? []).find(
      (c) => c.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (existing) {
      setError(`Категорія "${existing.name}" вже існує (група: ${existing.group_name})`);
      return;
    }

    createMutation.mutate(
      { name: trimmedName, group_name: groupValue },
      {
        onSuccess: (created) => {
          onCreated(created.name);
          onClose();
        },
        onError: (err) => {
          setError(err.message);
        },
      },
    );
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
      className="rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="w-[min(92vw,460px)] space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">Нова категорія</h2>
          <p className="text-sm text-slate-600">
            Додай категорію та обери групу — або створи нову групу.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className={FIELD_LABEL_CLASS} htmlFor="new-category-name">
              Назва категорії
            </label>
            <Input
              id="new-category-name"
              autoFocus
              placeholder="Напр. Тварини"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              disabled={pending}
            />
          </div>

          <div>
            <label className={FIELD_LABEL_CLASS} htmlFor="new-category-group">
              Група
            </label>
            <select
              id="new-category-group"
              className={SELECT_CLASS}
              value={groupChoice}
              onChange={(e) => {
                setGroupChoice(e.target.value);
              }}
              disabled={pending}
            >
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={NEW_GROUP_VALUE}>+ Нова група…</option>
            </select>
          </div>

          {isCreatingNewGroup && (
            <div>
              <label className={FIELD_LABEL_CLASS} htmlFor="new-category-group-name">
                Назва нової групи
              </label>
              <Input
                id="new-category-group-name"
                placeholder="Напр. Здоров'я"
                value={newGroupName}
                onChange={(e) => {
                  setNewGroupName(e.target.value);
                }}
                disabled={pending}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Скасувати
          </Button>
          <Button variant="primary" type="button" onClick={handleSubmit} disabled={pending}>
            {pending ? 'Створюю…' : 'Створити'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
