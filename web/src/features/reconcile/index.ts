// Public surface of the reconcile feature (statement → paid_by correction +
// orphan-transaction backlog).

export { StatementImportDialog } from './components/StatementImportDialog';
export { ReconcileResults } from './components/ReconcileResults';
export { OrphanList } from './components/OrphanList';
export type { OrphanMatch } from './components/OrphanList';
export { CreateStubReceiptDialog } from './components/CreateStubReceiptDialog';
export { buildStatementPrompt, STATEMENT_EXAMPLE_JSON } from './reconcile-prompt';

export { useStatementReceipts } from './api/use-statement-receipts';
export { useReassignPayerMutation } from './api/use-reassign-payer-mutation';
export type { ReassignPayerVars } from './api/use-reassign-payer-mutation';
export { useOrphanTransactions } from './api/use-orphan-transactions';
export { useSaveOrphansMutation } from './api/use-save-orphans-mutation';
export { useDismissOrphanMutation } from './api/use-dismiss-orphan-mutation';
export { useResolveOrphanMutation } from './api/use-resolve-orphan-mutation';
export type { ResolveOrphanVars } from './api/use-resolve-orphan-mutation';
export { useCreateStubReceiptMutation } from './api/use-create-stub-receipt-mutation';
export type {
  CreateStubReceiptVars,
  CreateStubReceiptResult,
} from './api/use-create-stub-receipt-mutation';
