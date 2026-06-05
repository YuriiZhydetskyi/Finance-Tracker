import type { ZodError } from 'zod';

// Flatten Zod issues into one human-readable line: "path: message; path: message".
// Shared by the JSON-import dialogs so validation errors read consistently.
export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
