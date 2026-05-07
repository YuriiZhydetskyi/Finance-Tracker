// Public export of the FX rate port. UI imports `fxRateProvider` only.
// To swap providers (e.g. ECB), point the re-export at a different adapter.
export type { IFxRateProvider } from './fx-rate.types';
export { nbuFxRateProvider as fxRateProvider } from './nbu-fx-rate-provider';
