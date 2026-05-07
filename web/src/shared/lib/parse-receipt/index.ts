// Public surface of the parse-receipt port. Swap to a different backend by
// changing the singleton export below; everything else (hooks, components)
// only sees the IParseReceiptService interface.

export type { IParseReceiptService, ParseReceiptInput } from './parse-receipt.types';
export { edgeFunctionParseReceiptService as parseReceiptService } from './edge-fn-parse-receipt';
