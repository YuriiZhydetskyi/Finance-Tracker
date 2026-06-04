import { describeError } from './error-details';

// Wraps a caught error with a human description of the failing step while
// keeping the original on `cause`, so the UI shows both: "<що робили>: <текст
// помилки>" up front, plus structured code/details/hint/issues underneath.
export function wrapError(operation: string, cause: unknown): Error {
  const inner = describeError(cause).message;
  const message = inner ? `${operation}: ${inner}` : operation;
  return new Error(message, { cause });
}
