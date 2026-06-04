import { useCallback, useEffect, useReducer, useRef } from 'react';
import { detectPairs, type ParsedReceipt } from '@finance-tracker/domain';
import { describeError } from '@/shared/utils/error-details';
import { useParseReceiptMutation } from '../api/use-parse-receipt-mutation';
import { prepareFile } from '../utils/prepare-file';
import { batchReducer } from './batch-reducer';
import {
  initialBatchState,
  PASTED_JSON_LABEL,
  type BatchEnqueueInput,
  type BatchItem,
} from './types';

type UseBatchParserOptions = {
  categories: string[];
  products: { name: string }[];
};

export function useBatchParser(opts: UseBatchParserOptions) {
  const [state, dispatch] = useReducer(batchReducer, initialBatchState);
  const parseMutation = useParseReceiptMutation();
  const { categories, products } = opts;

  const inFlightRef = useRef(false);
  const itemsRef = useRef<BatchItem[]>([]);

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

  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      }
    };
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const results = await Promise.allSettled(
      files.map(async (file): Promise<BatchEnqueueInput> => {
        const prepared = await prepareFile(file);
        return {
          id: crypto.randomUUID(),
          fileName: file.name || 'photo.jpg',
          blob: prepared.blob,
          previewUrl: prepared.previewUrl,
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
    dispatch({ type: 'reset' });
  }, []);

  return {
    state,
    addFiles,
    addParsedReceipt,
    addParsedReceipts,
    retryItem,
    removeItem,
    markSaved,
    goto,
    reset,
  };
}
