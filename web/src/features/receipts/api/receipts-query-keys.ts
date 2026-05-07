// Shared query-key constants so reads and mutations stay in sync.
// Mutation invalidation uses these; queries use them as their queryKey.

export const receiptsQueryKey = ['receipts'] as const;
export const receiptQueryKey = (id: string) => ['receipt', id] as const;
