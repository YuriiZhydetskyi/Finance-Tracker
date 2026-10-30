import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CARD_ATTRIBUTES_MAX,
  CARD_REVIEW_NOTES_MAX,
  attributesFromJson,
  makePackagedProductPhoto,
  mergeAttributes,
  mergeReviewNotes,
  packagedProductFromImport,
  sameAttributes,
  sameReviewNotes,
  type ProductAttributes,
} from '@finance-tracker/domain';
import { authService, packagingPhotoStorage } from '@/shared/lib/dependencies';
import { productsQueryKey } from '@/features/products/api/use-products';
import { supabase } from '@/shared/lib/supabase-client';
import type { Json } from '@/shared/types/database.types';
import { wrapError } from '@/shared/utils/wrap-error';
import {
  packagedProductsQueryKey,
  packagingCandidatesQueryKey,
} from './packaged-products-query-keys';
import { validatePackagingLinks, type ImportedPackagedProduct } from '../utils/packaging-import';

export type PackagingImportSource = {
  file_name: string;
  fingerprint: string;
  receipt_pages: number[];
  pages: Map<number, Blob>;
};

/** Stable IDs are held by the review screen across retries, including lost replies. */
export function createPackagingSavePlan(
  imports: ImportedPackagedProduct[],
  source: PackagingImportSource | null,
) {
  validatePackagingLinks(imports);
  return imports.map((product) => {
    const row = packagedProductFromImport(product.parsed, {
      import_source: 'manual-json',
      raw_import_json: {
        product: product.raw,
        source: source
          ? {
              file_name: source.file_name,
              sha256: source.fingerprint,
              receipt_pages: source.receipt_pages,
            }
          : null,
      },
    });
    const id = product.existing_product_id ?? row.id;
    const photos = product.source_pages.map((ref) => {
      const blob = source?.pages.get(ref.page);
      if (!source || !blob) throw new Error(`Немає JPEG для сторінки ${String(ref.page)}.`);
      return {
        blob,
        filename: `pdf-v1-${source.fingerprint}-${String(ref.page)}.jpg`,
        ref,
        note: `${source.file_name} · сторінка ${String(ref.page)} · SHA-256 ${source.fingerprint}`,
      };
    });
    return {
      id,
      name: row.name,
      row: product.existing_product_id ? null : row,
      photos,
      links: product.link_product_ids,
      // Written with the new row; merged into the stored card when one is reused.
      review_notes: product.parsed.review_notes,
      attributes: product.parsed.attributes,
    };
  });
}
export type PackagingSavePlan = ReturnType<typeof createPackagingSavePlan>;

/**
 * A reused card keeps its name and nutrition (ADR-0028), but what a newer import
 * found must not vanish. Doubts are appended, dropping only exact duplicates
 * (ADR-0030). «Інше» pairs are added when their key is new; a value already on the
 * card is the owner's edit or an earlier import and is never overwritten (ADR-0035).
 * Idempotent, so a replayed save does not grow either of them, and one write
 * carries both.
 */
async function mergeIntoReusedCard(
  id: string,
  stored: { review_notes: string[] | null | undefined; attributes: unknown },
  incoming: { review_notes: string[]; attributes: ProductAttributes },
) {
  const currentNotes = stored.review_notes ?? [];
  const mergedNotes =
    incoming.review_notes.length > 0
      ? mergeReviewNotes(currentNotes, incoming.review_notes)
      : currentNotes;
  const currentAttributes = attributesFromJson(stored.attributes);
  const mergedAttributes = mergeAttributes(currentAttributes, incoming.attributes);
  const notesChanged = !sameReviewNotes(mergedNotes, currentNotes);
  const attributesChanged = !sameAttributes(mergedAttributes, currentAttributes);
  if (!notesChanged && !attributesChanged) return;
  if (mergedNotes.length > CARD_REVIEW_NOTES_MAX) {
    throw new Error(
      `Картка вже має ${String(currentNotes.length)} приміток до перевірки, а з новими їх було б ${String(mergedNotes.length)} (максимум ${String(CARD_REVIEW_NOTES_MAX)}). Познач частину приміток перевіреними в картці й повтори збереження.`,
    );
  }
  const mergedCount = Object.keys(mergedAttributes).length;
  if (mergedCount > CARD_ATTRIBUTES_MAX) {
    throw new Error(
      `Картка вже має ${String(Object.keys(currentAttributes).length)} пунктів «Інше», а з новими їх було б ${String(mergedCount)} (максимум ${String(CARD_ATTRIBUTES_MAX)}). Видали частину пунктів у картці й повтори збереження.`,
    );
  }
  const { error } = await supabase
    .from('packaged_products')
    .update({
      ...(notesChanged ? { review_notes: mergedNotes } : {}),
      ...(attributesChanged ? { attributes: mergedAttributes } : {}),
    })
    .eq('id', id);
  if (error) throw wrapError('Не вдалося додати до картки примітки та пункти «Інше»', error);
}

export async function savePackagingPlan(
  plan: PackagingSavePlan,
  onProgress?: (message: string) => void,
) {
  const user = await authService.getCurrentUser();
  if (!user) throw new Error('Немає активного користувача. Увійди ще раз.');
  const result: { id: string; name: string }[] = [];
  for (const [index, entry] of plan.entries()) {
    onProgress?.(`Товар ${String(index + 1)} / ${String(plan.length)}: ${entry.name}`);
    if (entry.row) {
      // Ignore only a replay of this client-generated ID. Barcode collisions with
      // another card still fail and never overwrite its details.
      const { error } = await supabase.from('packaged_products').upsert(
        {
          ...entry.row,
          raw_import_json: entry.row.raw_import_json as Json,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (error)
        throw wrapError(
          'Не вдалося створити картку. Можливо, такий штрихкод уже є в каталозі',
          error,
        );
    }
    const { data: card, error: cardError } = await supabase
      .from('packaged_products')
      .select('id, review_notes, attributes')
      .eq('id', entry.id)
      .single();
    if (cardError || !card) throw wrapError('Картка недоступна або видалена', cardError);
    if (!entry.row) await mergeIntoReusedCard(entry.id, card, entry);

    for (const [photoIndex, photo] of entry.photos.entries()) {
      const path = `${user.email}/${entry.id}/${photo.filename}`;
      const { data: recorded, error: lookupError } = await supabase
        .from('packaged_product_photos')
        .select('id')
        .eq('storage_path', path)
        .maybeSingle();
      if (lookupError) throw wrapError('Не вдалося перевірити збережені фото', lookupError);
      if (recorded) continue;
      try {
        await packagingPhotoStorage.uploadToPath(photo.blob, path);
      } catch (error) {
        // A signed URL confirms a content-addressed upload with a lost reply.
        // Never delete potentially referenced objects after an ambiguous error.
        try {
          await packagingPhotoStorage.getSignedUrl(path);
        } catch {
          throw error;
        }
      }
      const row = makePackagedProductPhoto({
        packaged_product_id: entry.id,
        storage_path: path,
        kind: photo.ref.kind,
        content_type: 'image/jpeg',
        byte_size: photo.blob.size,
        sort_order: photoIndex,
        note: photo.note,
      });
      const { error } = await supabase
        .from('packaged_product_photos')
        .upsert(row, { onConflict: 'storage_path', ignoreDuplicates: true });
      if (error)
        throw wrapError(
          'Не вдалося записати фото. Повтори збереження, щоб завершити імпорт',
          error,
        );
    }

    // A queue entry is linked only after all its requested photos are recorded.
    for (const productId of entry.links) {
      const { error } = await supabase
        .from('products')
        .update({ packaged_product_id: entry.id })
        .eq('id', productId)
        .is('packaged_product_id', null);
      if (error) throw wrapError('Не вдалося прив’язати магазинну позицію', error);
      const { data, error: readError } = await supabase
        .from('products')
        .select('packaged_product_id')
        .eq('id', productId)
        .single();
      if (readError || data?.packaged_product_id !== entry.id) {
        throw new Error(
          'Магазинна позиція вже прив’язана до іншої картки або недоступна. Перевір прив’язки в каталозі.',
        );
      }
    }
    result.push({ id: entry.id, name: entry.name });
  }
  return result;
}

export function useSavePackagedProductsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      plan,
      onProgress,
    }: {
      plan: PackagingSavePlan;
      onProgress?: (message: string) => void;
    }) => savePackagingPlan(plan, onProgress),
    // Partial progress is real data too; keeping it invisible invites duplicates.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
      void queryClient.invalidateQueries({ queryKey: packagingCandidatesQueryKey });
      void queryClient.invalidateQueries({ queryKey: productsQueryKey });
    },
  });
}
