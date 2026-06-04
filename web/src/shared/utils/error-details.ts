// Normalizes any thrown value into a flat, displayable shape. Duck-types the
// shapes we actually throw — Supabase PostgrestError (code/details/hint),
// AuthError (status), Zod (issues) — without importing their types, and walks
// the `cause` chain so wrapped errors keep the underlying reason. No `stack`:
// the user wants the failing step + the error text, not minified line numbers.

export type ErrorDetail = {
  message: string;
  name?: string;
  code?: string;
  details?: string;
  hint?: string;
  issues?: string[];
  cause?: ErrorDetail;
};

const MAX_CAUSE_DEPTH = 8;
const FALLBACK_MESSAGE = 'Невідома помилка';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Duck-types a ZodError: `{ issues: [{ path: (string|number)[], message }] }`.
function readIssues(value: Record<string, unknown>): string[] | undefined {
  const { issues } = value;
  if (!Array.isArray(issues)) return undefined;
  const lines = issues.map((issue: unknown) => {
    if (!isRecord(issue)) return String(issue);
    const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
    const message = typeof issue.message === 'string' ? issue.message : 'invalid';
    return path ? `${path}: ${message}` : message;
  });
  return lines.length > 0 ? lines : undefined;
}

function describeAt(error: unknown, depth: number): ErrorDetail {
  if (typeof error === 'string') return { message: error || FALLBACK_MESSAGE };
  if (!isRecord(error)) return { message: String(error) };

  const rawMessage = error.message;
  const message =
    typeof rawMessage === 'string' && rawMessage !== '' ? rawMessage : FALLBACK_MESSAGE;

  const detail: ErrorDetail = { message };

  if (typeof error.name === 'string' && error.name !== '') detail.name = error.name;

  if (typeof error.code === 'string' && error.code !== '') detail.code = error.code;
  else if (typeof error.code === 'number') detail.code = String(error.code);
  else if (typeof error.status === 'number') detail.code = String(error.status);

  if (typeof error.details === 'string' && error.details !== '') detail.details = error.details;
  if (typeof error.hint === 'string' && error.hint !== '') detail.hint = error.hint;

  const issues = readIssues(error);
  if (issues) detail.issues = issues;

  if (depth < MAX_CAUSE_DEPTH && error.cause != null) {
    detail.cause = describeAt(error.cause, depth + 1);
  }

  return detail;
}

export function describeError(error: unknown): ErrorDetail {
  return describeAt(error, 0);
}

// Human-readable multi-line rendering, shown in the UI detail block and copied
// by the "Копіювати" button. One source of truth for the displayed format.
export function serializeErrorDetail(detail: ErrorDetail): string {
  const lines: string[] = [];

  const walk = (d: ErrorDetail, indent: string): void => {
    lines.push(`${indent}${d.message}`);
    if (d.name && d.name !== 'Error') lines.push(`${indent}  тип: ${d.name}`);
    if (d.code) lines.push(`${indent}  код: ${d.code}`);
    if (d.details) lines.push(`${indent}  деталі: ${d.details}`);
    if (d.hint) lines.push(`${indent}  підказка: ${d.hint}`);
    if (d.issues && d.issues.length > 0) {
      lines.push(`${indent}  проблеми:`);
      for (const issue of d.issues) lines.push(`${indent}    - ${issue}`);
    }
    if (d.cause) {
      lines.push(`${indent}  причина:`);
      walk(d.cause, `${indent}    `);
    }
  };

  walk(detail, '');
  return lines.join('\n');
}
