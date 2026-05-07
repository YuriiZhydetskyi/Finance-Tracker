// Single barrel of cross-feature singletons (the "ports" from §0.3 of the
// migration plan). Routes / components / hooks import from here, not from
// the per-port folders directly. Adapter swaps happen inside each port's
// own index.ts.

export { authService } from './auth';
export type { AuthUser, IAuthService } from './auth';

export { fxRateProvider } from './fx-rate';
export type { IFxRateProvider } from './fx-rate';

export { parseReceiptService } from './parse-receipt';
export type { IParseReceiptService, ParseReceiptInput } from './parse-receipt';

export { photoStorage } from './photo-storage';
export type { IPhotoStorage, UploadedPhoto } from './photo-storage';
