import { useCallback, useEffect, useReducer, useRef } from 'react';
import { detectPairs, type ParsedReceipt } from '@finance-tracker/domain';
import { describeError, serializeErrorDetail } from '@/shared/utils/error-details';
import { isPdfPath } from '@/shared/utils/is-pdf-path';
import {
  useCreatePendingParseMutation,
  useIncrementPendingAttemptsMutation,
} from '@/features/pending-parses';
import { useParseReceiptMutation } from '../api/use-parse-receipt-mutation';
import { prepareFile } from '../utils/prepare-file';
import { batchReducer } from './batch-reducer';
import {
  initialBatchState,
  MAX_RETRY_ATTEMPTS,
  PASTED_JSON_LABEL,
  type BatchEnqueueInput,
  type BatchItem,
  type HydratePendingInput,
} from './types';

type UseBatchParserOptions = {
  categories: string[];
  products: { name: string }[];
};

export type AddFileInput = { file: File; paidBy: string };

export type HydratePendingItem = {
  pendingId: string;
  photoPath: string;
  paidBy: string;
  fileName: string;
  blob: Blob;
  /** The queue row's current attempts, so re-failures bump it cumulatively. */
  baseAttempts: number;
};

export function useBatchParser(opts: UseBatchParserOptions) {
  const [state, dispatch] = useReducer(batchReducer, initialBatchState);
  const parseMutation = useParseReceiptMutation();
  const createPending = useCreatePendingParseMutation();
  const incrementAttempts = useIncrementPendingAttemptsMutation();
  const { categories, products } = opts;

  const inFlightRef = useRef(false);
  const itemsRef = useRef<BatchItem[]>([]);
  // Ids already handed off to the queue — guards the persist effect (which
  // re-runs on every render) from firing twice for the same failed item.
  const archivingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    itemsRef.current = state.items;
  });

  useEffect(() => {
    if (inFlightRef.current) return;
    const next = state.items.find((i) => i.status.kind === 'queued');
    if (!next) return;

    const targetId = next.id;
    const targetBlob = next.blob;
    inFlightRef.current = true;
    dispatch({ type: 'parseStart', id: targetId });

    void parseMutation
      .mutateAsync({ blob: targetBlob, categories, products })
      .then((parsed) => {
        inFlightRef.current = false;
        dispatch({
          type: 'parseSuccess',
          id: targetId,
          parsed,
          pairResult: detectPairs(parsed.items),
        });
      })
      .catch((e: unknown) => {
        inFlightRef.current = false;
        dispatch({ type: 'parseError', id: targetId, detail: describeError(e) });
      });
  }, [state.items, parseMutation, categories, products]);

  // Persist a failed parse so it survives the tab closing. Fresh photos get a
  // new queue row (photo uploaded here — the happy path uploads only at save);
  // items hydrated FROM the queue just bump their existing row's attempts.
  const archiveFailedItem = useCallback(
    (item: BatchItem) => {
      if (item.status.kind !== 'parse-error') return;
      if (archivingRef.current.has(item.id)) return;
      archivingRef.current.add(item.id);
      const errorMessage = serializeErrorDetail(item.status.detail);

      if (item.pendingParse) {
        // Cumulative: the row's prior attempts plus the failures in this session.
        const attempts = item.pendingParse.baseAttempts + item.attempts;
        void incrementAttempts
          .mutateAsync({ id: item.pendingParse.id, attempts, errorMessage })
          .catch(() => {
            /* leave the card as-is; the row stays for a later retry from /pending */
          });
        return;
      }

      void createPending
        .mutateAsync({
          blob: item.blob,
          paidBy: item.paidBy,
          errorMessage,
          fileName: item.fileName,
          attempts: item.attempts,
        })
        .then((res) => {
          const stored = itemsRef.current.find((i) => i.id === item.id);
          if (stored?.previewUrl) URL.revokeObjectURL(stored.previewUrl);
          dispatch({ type: 'archiveSuccess', id: item.id, pendingId: res.id });
        })
        .catch(() => {
          // Persist failed (e.g. Storage upload). Un-mark so it can be retried;
          // the card stays in parse-error so nothing is lost silently.
          archivingRef.current.delete(item.id);
        });
    },
    [createPending, incrementAttempts],
  );

  useEffect(() => {
    const item = state.items.find(
      (i) =>
        i.status.kind === 'parse-error' &&
        i.attempts >= MAX_RETRY_ATTEMPTS &&
        !archivingRef.current.has(i.id),
    );
    if (item) archiveFailedItem(item);
  }, [state.items, archiveFailedItem]);

  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      }
    };
  }, []);

  const addFiles = useCallback(async (inputs: AddFileInput[]) => {
    if (inputs.length === 0) return;
    const results = await Promise.allSettled(
      inputs.map(async ({ file, paidBy }): Promise<BatchEnqueueInput> => {
        const prepared = await prepareFile(file);
        return {
          id: crypto.randomUUID(),
          fileName: file.name || 'photo.jpg',
          blob: prepared.blob,
          previewUrl: prepared.previewUrl,
          paidBy,
        };
      }),
    );
    const enqueueInputs: BatchEnqueueInput[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') enqueueInputs.push(r.value);
      else console.error('File prep failed; skipping file', r.reason);
    }
    if (enqueueInputs.length > 0) dispatch({ type: 'enqueued', items: enqueueInputs });
  }, []);

  const hydratePending = useCallback((items: HydratePendingItem[]) => {
    if (items.length === 0) return;
    dispatch({
      type: 'hydratePending',
      items: items.map(
        (it): HydratePendingInput => ({
          id: crypto.randomUUID(),
          fileName: it.fileName,
          blob: it.blob,
          previewUrl: isPdfPath(it.photoPath) ? null : URL.createObjectURL(it.blob),
          paidBy: it.paidBy,
          pendingParse: {
            id: it.pendingId,
            photoPath: it.photoPath,
            baseAttempts: it.baseAttempts,
          },
        }),
      ),
    });
  }, []);

  const addParsedReceipts = useCallback((receipts: ParsedReceipt[]) => {
    if (receipts.length === 0) return;
    // Single dispatch so cross-receipt numbering stays correct — itemsRef only
    // refreshes after a render, so per-receipt dispatches would all read the
    // same stale count and collide on "#N".
    const base = itemsRef.current.filter((i) => i.source === 'manual-json').length;
    dispatch({
      type: 'manualParsedMany',
      items: receipts.map((parsed, idx) => ({
        id: crypto.randomUUID(),
        fileName: `${PASTED_JSON_LABEL} #${base + idx + 1}`,
        parsed,
        pairResult: detectPairs(parsed.items),
      })),
    });
  }, []);

  const addParsedReceipt = useCallback(
    (parsed: ParsedReceipt) => addParsedReceipts([parsed]),
    [addParsedReceipts],
  );

  const retryItem = useCallback((id: string) => {
    dispatch({ type: 'retry', id });
  }, []);

  // Persist a failed item to the queue immediately, even before retries are
  // exhausted — lets the user bail without burning attempts.
  const deferItem = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (item) archiveFailedItem(item);
    },
    [archiveFailedItem],
  );

  const removeItem = useCallback((id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    dispatch({ type: 'remove', id });
  }, []);

  const markSaved = useCallback((id: string, receipt_id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    dispatch({ type: 'saveSuccess', id, receipt_id });
  }, []);

  const goto = useCallback((index: number) => {
    dispatch({ type: 'goto', index });
  }, []);

  const reset = useCallback(() => {
    for (const it of itemsRef.current) {
      if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    }
    archivingRef.current.clear();
    dispatch({ type: 'reset' });
  }, []);

  return {
    state,
    addFiles,
    hydratePending,
    addParsedReceipt,
    addParsedReceipts,
    retryItem,
    deferItem,
    removeItem,
    markSaved,
    goto,
    reset,
  };
}
