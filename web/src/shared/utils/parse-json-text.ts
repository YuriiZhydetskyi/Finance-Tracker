// Tolerant JSON extraction from an AI-tool paste. Strips a ```json fence when
// present, else falls back to slicing the outermost { … } so a blob wrapped in
// prose still parses. Throws friendly Ukrainian messages instead of JSON.parse's
// positional native error. Shared by the receipt and bank-statement import dialogs.
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Спочатку вставте JSON.');

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Best-effort recovery when JSON is surrounded by prose. Misbehaves when
    // trailing prose also contains '}' (lastIndexOf overshoots) — rare in AI
    // tool output. The inner parse is wrapped so users always see the friendly
    // message instead of JSON.parse's positional native error.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // fall through to friendly error
      }
    }
    throw new Error('Не вдалося розпарсити JSON.');
  }
}
