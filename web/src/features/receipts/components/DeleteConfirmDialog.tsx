import { useModalDialog } from '@/shared/hooks/use-modal-dialog';
import { Button } from '@/shared/ui/Button';

type Props = {
  open: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmDialog({ open, pending, onCancel, onConfirm }: Props) {
  const ref = useModalDialog(open);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="w-[min(92vw,420px)] space-y-3 p-5">
        <h2 className="text-lg font-semibold">Видалити чек?</h2>
        <p className="text-sm text-slate-600">
          Це безповоротно. Чек і всі його товари будуть видалені.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onCancel} disabled={pending}>
            Скасувати
          </Button>
          <Button variant="danger" type="button" onClick={onConfirm} disabled={pending}>
            {pending ? 'Видаляю...' : 'Так, видалити'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
