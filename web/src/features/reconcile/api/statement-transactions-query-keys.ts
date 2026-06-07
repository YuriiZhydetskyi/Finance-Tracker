// Cache key for persisted orphan statement transactions (status='unmatched').
// Mutations that add / resolve / dismiss orphans invalidate this prefix.
export const statementTransactionsQueryKey = ['statement-transactions'] as const;
