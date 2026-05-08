import { useCallback, useEffect, useReducer, useRef } from 'react';
import { detectPairs } from '@finance-tracker/domain';
import { useParseReceiptMutation } from '../api/use-parse-receipt-mutation';
import { resizeImage } from '../utils/resize-image';
import { batchReducer } from './batch-reducer';
import { initialBatchState, type BatchEnqueueInput, type BatchItem } from './types';

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
        dispatch({
          type: 'parseError',
          id: targetId,
          message: e instanceof Error ? e.message : 'Не вдалося розпізнати чек.',
        });
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
        const blob = await resizeImage(file);
        return {
          id: crypto.randomUUID(),
          fileName: file.name || 'photo.jpg',
          blob,
          previewUrl: URL.createObjectURL(blob),
        };
      }),
    );
    const enqueueInputs: BatchEnqueueInput[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') enqueueInputs.push(r.value);
      else console.error('Resize failed; skipping file', r.reason);
    }
    if (enqueueInputs.length > 0) dispatch({ type: 'enqueued', items: enqueueInputs });
  }, []);

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

  return { state, addFiles, retryItem, removeItem, markSaved, goto, reset };
}
