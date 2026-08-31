import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ulid } from '@finance-tracker/domain';
import { prepareFile } from '@/features/photo';
import { photoStorage } from '@/shared/lib/dependencies';
import { supabase } from '@/shared/lib/supabase-client';
import type { Json, Tables } from '@/shared/types/database.types';

export type ImportBatch = Tables<'receipt_import_batches'>;
export type ImportFile = Tables<'receipt_import_files'>;

export const importBatchesQueryKey = ['receipt-import-batches'] as const;
export const importBatchQueryKey = (id: string) => ['receipt-import-batches', id] as const;

export type ImportProgress = {
  completed: number;
  total: number;
  phase: 'preparing' | 'uploading';
};

type CreateInput = {
  files: File[];
  paidBy: string;
  onProgress?: (progress: ImportProgress) => void;
};

type PreparedUpload = {
  id: string;
  file: File;
  blob: Blob;
  mimeType: string;
  sha256: string;
};

export function useImportBatches() {
  return useQuery({
    queryKey: importBatchesQueryKey,
    queryFn: async (): Promise<ImportBatch[]> => {
      const { data, error } = await supabase
        .from('receipt_import_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });
}

export function useImportBatch(id: string) {
  return useQuery({
    queryKey: importBatchQueryKey(id),
    queryFn: async (): Promise<{ batch: ImportBatch; files: ImportFile[] }> => {
      const [batchResult, filesResult] = await Promise.all([
        supabase.from('receipt_import_batches').select('*').eq('id', id).single(),
        supabase.from('receipt_import_files').select('*').eq('batch_id', id).order('created_at'),
      ]);
      if (batchResult.error) throw batchResult.error;
      if (filesResult.error) throw filesResult.error;
      return { batch: batchResult.data, files: filesResult.data };
    },
    refetchInterval: (query) => {
      const status = query.state.data?.batch.status;
      return status === 'uploading' || status === 'processing' ? 5_000 : false;
    },
  });
}

export function useCreateImportBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, paidBy, onProgress }: CreateInput): Promise<string> => {
      if (files.length < 1 || files.length > 200) {
        throw new Error('Вибери від 1 до 200 файлів.');
      }
      if (!paidBy) throw new Error('Вибери платника.');

      let preparedCount = 0;
      const prepared = await mapLimit(files, 2, async (file): Promise<PreparedUpload> => {
        const result = await prepareFile(file);
        let sha256: string;
        try {
          sha256 = await hashBlob(result.blob);
        } finally {
          if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
        }
        preparedCount += 1;
        onProgress?.({ completed: preparedCount, total: files.length, phase: 'preparing' });
        return { id: ulid(), file, blob: result.blob, mimeType: result.mimeType, sha256 };
      });

      const batchId = ulid();
      const descriptors = prepared.map((entry) => ({
        id: entry.id,
        original_filename: entry.file.name || 'document',
        mime_type: entry.mimeType,
        original_size_bytes: entry.blob.size,
        content_sha256: entry.sha256,
      }));
      const { data: registrations, error: registerError } = await supabase.rpc(
        'create_receipt_import_batch',
        { p_batch_id: batchId, p_paid_by: paidBy, p_files: descriptors as unknown as Json },
      );
      if (registerError) throw registerError;

      const byId = new Map(prepared.map((entry) => [entry.id, entry]));
      const uploadable = (registrations ?? []).filter(
        (row) => row.status === 'uploading' && row.storage_path,
      );
      let uploadedCount = 0;
      await mapLimit(uploadable, 2, async (registration) => {
        const entry = byId.get(registration.id);
        if (!entry || !registration.storage_path) return;
        try {
          await photoStorage.uploadToPath(entry.blob, registration.storage_path);
          const { error: queueError } = await supabase.rpc('queue_receipt_import_file', {
            p_file_id: entry.id,
          });
          if (queueError) throw queueError;
        } catch (error) {
          await supabase.rpc('mark_receipt_import_upload_failed', {
            p_file_id: entry.id,
            p_error_message: error instanceof Error ? error.message : 'Upload failed',
          });
        } finally {
          uploadedCount += 1;
          onProgress?.({ completed: uploadedCount, total: uploadable.length, phase: 'uploading' });
        }
      });

      return batchId;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: importBatchesQueryKey });
    },
  });
}

export function useRequeueImportFile(batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      forceReceipt,
      skipDuplicate = false,
    }: {
      id: string;
      forceReceipt: boolean;
      skipDuplicate?: boolean | undefined;
    }) => {
      const { error } = await supabase.rpc('requeue_receipt_import_file', {
        p_file_id: id,
        p_force_receipt: forceReceipt,
        p_skip_duplicate_check: skipDuplicate,
      });
      if (error) throw error;
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: importBatchQueryKey(batchId) }),
  });
}

export function useDiscardImportFile(batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: ImportFile) => {
      if (file.storage_path) {
        await photoStorage.remove(file.storage_path).catch(() => undefined);
      }
      const { error } = await supabase.rpc('discard_receipt_import_file', { p_file_id: file.id });
      if (error) throw error;
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: importBatchQueryKey(batchId) }),
  });
}

export function useResolveImportFile(batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, receiptId }: { id: string; receiptId: string }) => {
      const { error } = await supabase.rpc('resolve_receipt_import_file', {
        p_file_id: id,
        p_receipt_id: receiptId,
      });
      if (error) throw error;
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: importBatchQueryKey(batchId) }),
  });
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}
