// Single barrel of cross-feature singletons (the "ports" from §0.3 of the
// migration plan). Routes / components / hooks import from here, not from
// the per-port folders directly. Adapter swaps happen inside each port's
// own index.ts.
//
// More ports added in later phases:
//   - photoStorage   (Phase 8)
//   - fxRateProvider (Phase 5)
//   - parseReceiptService (Phase 7/8)

export { authService } from './auth';
export type { AuthUser, IAuthService } from './auth';

export { fxRateProvider } from './fx-rate';
export type { IFxRateProvider } from './fx-rate';
