import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  reconcileStatement,
  type NormalizedStatementTxn,
  type StatementTransaction,
  type StatementTransactionInput,
  type ToFixEntry,
} from '@finance-tracker/domain';
import { RequireAuth, useAppUsers } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useReceipts } from '@/features/receipts';
import {
  CreateStubReceiptDialog,
  OrphanList,
  ReconcileResults,
  StatementImportDialog,
  useDismissOrphanMutation,
  useOrphanTransactions,
  useReassignPayerMutation,
  useResolveOrphanMutation,
  useSaveOrphansMutation,
  useStatementReceipts,
  type OrphanMatch,
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

// A statement line that matched no receipt becomes a persisted orphan, attributed
// to the card owner. Refunds never reach here (they aren't 'no-candidate').
function toOrphanInput(txn: NormalizedStatementTxn, owner: string): StatementTransactionInput {
  return {
    date: txn.date,
    amount_orig: txn.amount,
    currency: txn.currency,
    time: txn.time,
    merchant: txn.merchant,
    raw: txn.raw,
    suggested_category: txn.category,
    paid_by: owner,
  };
}

// Re-check stored orphans against current receipts, so a receipt entered AFTER the
// statement import surfaces here as a suggested link. Owner is irrelevant to
// matching (currency+amount+date only); a sentinel owner routes every match into
// toFix, and we compute needsFlip ourselves from the orphan's card owner.
const NO_OWNER = ' no-owner';

// Bound the re-match: only recent orphans, only against receipts in the same
// window, and only receipts entered AFTER the orphan (older ones were already
// ruled out at import). Keeps the work O(recent) instead of full-history x N.
const REMATCH_MONTHS = 2;
const REMATCH_RECEIPT_LIMIT = 1000;

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function Reconcile() {
  const appUsersQuery = useAppUsers();
  const owners = useMemo(() => appUsersQuery.data ?? [], [appUsersQuery.data]);
  const categoriesQuery = useCategories();
  const categoryNames = useMemo(
    () => (categoriesQuery.data ?? []).map((c) => c.name),
    [categoriesQuery.data],
  );

  const [dialogOpen, setDialogOpen] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  // Bumped per import so <ReconcileResults> remounts with fresh selection state —
  // otherwise a prior import's de-selections (keyed by txn index, which restarts
  // at 0) would silently carry over to the next statement.
  const [runId, setRunId] = useState(0);
  const [stubOrphan, setStubOrphan] = useState<StatementTransaction | null>(null);

  const receiptsQuery = useStatementReceipts(session?.txns ?? []);
  const reassign = useReassignPayerMutation();
  const saveOrphans = useSaveOrphansMutation();
  const dismissOrphan = useDismissOrphanMutation();
  const resolveOrphan = useResolveOrphanMutation();

  const result = useMemo(() => {
    if (!session || !receiptsQuery.data) return null;
    return reconcileStatement(session.txns, receiptsQuery.data, session.owner);
  }, [session, receiptsQuery.data]);

  // Persist the no-candidate lines once per import (guard by runId), so they
  // survive reloads and can be re-matched later. Upsert dedups, so this is safe
  // even if the effect runs twice.
  const persistedRunId = useRef(-1);
  useEffect(() => {
    if (!session || !result || persistedRunId.current === runId) return;
    persistedRunId.current = runId;
    const orphanInputs = result.unmatchedStatementLines
      .filter((u) => u.reason === 'no-candidate')
      .map((u) => toOrphanInput(u.txn, session.owner));
    if (orphanInputs.length > 0) saveOrphans.mutate(orphanInputs);
  }, [session, result, runId, saveOrphans]);

  // ── Orphan backlog (persisted across sessions) ──────────────────────────────
  const orphansQuery = useOrphanTransactions();
  const orphans = useMemo(() => orphansQuery.data ?? [], [orphansQuery.data]);

  // Re-match only RECENT orphans against RECENT receipts (bounded window).
  const rematchCutoff = useMemo(() => isoMonthsAgo(REMATCH_MONTHS), []);
  const recentOrphans = useMemo(
    () => orphans.filter((o) => o.date >= rematchCutoff),
    [orphans, rematchCutoff],
  );

  const orphanTxns = useMemo<NormalizedStatementTxn[]>(
    () =>
      recentOrphans.map((o, index) => ({
        index,
        date: o.date,
        amount: o.amount_orig,
        currency: o.currency,
        time: o.time,
        merchant: o.merchant,
        raw: o.raw,
        category: o.suggested_category,
        isRefund: false,
      })),
    [recentOrphans],
  );

  const rematchReceiptsQuery = useReceipts({ dateFrom: rematchCutoff }, REMATCH_RECEIPT_LIMIT, {
    enabled: recentOrphans.length > 0,
  });

  const orphanMatches = useMemo<Map<string, OrphanMatch>>(() => {
    const map = new Map<string, OrphanMatch>();
    if (rematchReceiptsQuery.data == null || orphanTxns.length === 0) return map;
    const res = reconcileStatement(orphanTxns, rematchReceiptsQuery.data, NO_OWNER);
    for (const link of res.toFix) {
      const orphan = recentOrphans[link.txn.index];
      // Only suggest receipts entered AFTER the orphan — anything older was already
      // available (and rejected) when the statement was first imported.
      if (orphan && link.receipt.created_at > orphan.created_at) {
        map.set(orphan.id, {
          receipt: link.receipt,
          needsFlip: link.receipt.paid_by !== orphan.paid_by,
        });
      }
    }
    return map;
  }, [orphanTxns, recentOrphans, rematchReceiptsQuery.data]);

  const handleReconcile = (owner: string, txns: NormalizedStatementTxn[]) => {
    setSession({ owner, txns });
    setRunId((n) => n + 1);
    setDialogOpen(false);
  };

  const handleApply = (entries: ToFixEntry[]) => {
    if (!session || entries.length === 0) return;
    reassign.mutate({ ids: entries.map((e) => e.receipt.id), paid_by: session.owner });
  };

  const handleLinkOrphan = (orphan: StatementTransaction, match: OrphanMatch) => {
    const resolve = () => resolveOrphan.mutate({ id: orphan.id, receipt_id: match.receipt.id });
    // Only mark the orphan resolved AFTER the payer flip lands — otherwise a failed
    // reassign would leave the orphan gone but the receipt's paid_by still wrong.
    if (match.needsFlip) {
      reassign.mutate({ ids: [match.receipt.id], paid_by: orphan.paid_by }, { onSuccess: resolve });
    } else {
      resolve();
    }
  };

  const orphanBusy = dismissOrphan.isPending || resolveOrphan.isPending || reassign.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Звірка виписки</h1>
          <p className="text-sm text-slate-600">
            Завантаж виписку з картки — знайдемо чеки, віднесені не на того, хто платив, і
            запропонуємо виправити. Витрати без чека потраплять до списку нижче.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setDialogOpen(true)}>
          Завантажити виписку
        </Button>
      </div>

      <StatementImportDialog
        open={dialogOpen}
        owners={owners}
        categories={categoryNames}
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
      {saveOrphans.isError && (
        <ErrorDetails error={saveOrphans.error} label="Не вдалося зберегти транзакції без чека" />
      )}
      {dismissOrphan.isError && (
        <ErrorDetails error={dismissOrphan.error} label="Не вдалося приховати транзакцію" />
      )}
      {resolveOrphan.isError && (
        <ErrorDetails error={resolveOrphan.error} label="Не вдалося зв'язати транзакцію з чеком" />
      )}

      {result && (
        <ReconcileResults
          key={runId}
          result={result}
          onApply={handleApply}
          isApplying={reassign.isPending}
        />
      )}

      <OrphanList
        orphans={orphans}
        matches={orphanMatches}
        onCreate={(orphan) => setStubOrphan(orphan)}
        onDismiss={(id) => dismissOrphan.mutate(id)}
        onLink={handleLinkOrphan}
        busy={orphanBusy}
      />

      <CreateStubReceiptDialog
        orphan={stubOrphan}
        onClose={() => setStubOrphan(null)}
        onCreated={() => setStubOrphan(null)}
      />
    </div>
  );
}
