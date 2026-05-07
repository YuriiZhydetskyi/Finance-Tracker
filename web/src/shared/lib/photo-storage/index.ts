// Public surface of the photo-storage port. Swap to Cloudflare R2 / S3 by
// changing the singleton export below; everything else (mutations, components)
// only sees the IPhotoStorage interface.

export type { IPhotoStorage, UploadedPhoto } from './photo-storage.types';
export { supabasePhotoStorage as photoStorage } from './supabase-photo-storage';
