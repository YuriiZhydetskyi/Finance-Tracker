import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  reconcileStatement,
  type NormalizedStatementTxn,
  type ToFixEntry,
} from '@finance-tracker/domain';
import { RequireAuth, useAppUsers } from '@/features/auth';
import {
  ReconcileResults,
  StatementImportDialog,
  useReassignPayerMutation,
  useStatementReceipts,
} from '@/features/reconcile';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';

export const Route = createFileRoute('/reconcile')({
  component: ReconcilePage,
});

function ReconcilePage() {
  return (
    <RequireAuth>
      <Reconcile />
    </RequireAuth>
  );
}

type Session = { owner: string; txns: NormalizedStatementTxn[] };

function Reconcile() {
  const appUsersQuery = useAppUsers();
  const owners = useMemo(() => appUsersQuery.data ?? [], [appUsersQuery.data]);

  const [dialogOpen, setDialogOpen] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  // Bumped per import so <ReconcileResults> remounts with fresh selection state —
  // otherwise a prior import's de-selections (keyed by txn index, which restarts
  // at 0) would silently carry over to the next statement.
  const [runId, setRunId] = useState(0);

  const receiptsQuery = useStatementReceipts(session?.txns ?? []);
  const reassign = useReassignPayerMutation();

  const result = useMemo(() => {
    if (!session || !receiptsQuery.data) return null;
    return reconcileStatement(session.txns, receiptsQuery.data, session.owner);
  }, [session, receiptsQuery.data]);

  const handleReconcile = (owner: string, txns: NormalizedStatementTxn[]) => {
    setSession({ owner, txns });
    setRunId((n) => n + 1);
    setDialogOpen(false);
  };

  const handleApply = (entries: ToFixEntry[]) => {
    if (!session || entries.length === 0) return;
    reassign.mutate({ ids: entries.map((e) => e.receipt.id), paid_by: session.owner });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Звірка виписки</h1>
          <p className="text-sm text-slate-600">
            Завантаж виписку з картки — знайдемо чеки, віднесені не на того, хто платив, і
            запропонуємо виправити.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setDialogOpen(true)}>
          Завантажити виписку
        </Button>
      </div>

      <StatementImportDialog
        open={dialogOpen}
        owners={owners}
        onClose={() => setDialogOpen(false)}
        onReconcile={handleReconcile}
      />

      {session && (
        <p className="text-sm text-slate-500">
          Картка: <span className="font-medium text-slate-700">{session.owner}</span> ·{' '}
          {session.txns.length} транзакцій
        </p>
      )}

      {session && receiptsQuery.isLoading && (
        <p className="text-sm text-slate-500">Завантажую чеки…</p>
      )}
      {session && receiptsQuery.isError && (
        <ErrorDetails error={receiptsQuery.error} label="Не вдалося завантажити чеки" />
      )}

      {reassign.isError && (
        <ErrorDetails error={reassign.error} label="Не вдалося оновити платника" />
      )}

      {result && (
        <ReconcileResults
          key={runId}
          result={result}
          onApply={handleApply}
          isApplying={reassign.isPending}
        />
      )}
    </div>
  );
}
