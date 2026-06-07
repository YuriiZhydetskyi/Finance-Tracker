// Prompt the user copies into an external AI tool to turn card-statement
// screenshots into JSON our import dialog can validate. Mirrors the receipt
// import prompt; the cardholder is intentionally NOT extracted (chosen in-app).

export const STATEMENT_EXAMPLE_JSON = `{
  "transactions": [
    {
      "date": "2026-05-25",
      "amount": 12.34,
      "currency": "EUR",
      "time": "14:32",
      "merchant": "Lidl",
      "raw": "LIDL DIENSTLEISTUNG SAGT DANKE",
      "category": "Бакалія"
    },
    {
      "date": "2026-05-26",
      "amount": 8.9,
      "currency": "EUR",
      "time": null,
      "merchant": "McDonald's",
      "raw": "MCDONALDS 123 BERLIN",
      "category": "Кафе/ресторани"
    }
  ]
}`;

export function buildStatementPrompt(categories: string[] = []): string {
  const categoryList = categories.join(', ');
  return [
    'Analyze the attached bank/card statement screenshot(s) and return only valid JSON. No markdown, no comments, no explanatory text.',
    '',
    'Return an object of this shape (or a bare array of the transaction objects):',
    STATEMENT_EXAMPLE_JSON,
    '',
    'Rules:',
    '- One object per real card transaction (a purchase or a refund).',
    '- date: posting date as YYYY-MM-DD.',
    '- amount: the charged amount as a positive number. Refunds/credits must be negative.',
    '- currency: ISO 4217 code of the transaction (do not convert between currencies).',
    '- time: HH:MM in 24-hour time if the statement shows a per-transaction time, otherwise null.',
    '- merchant: cleaned merchant name if visible, otherwise null.',
    '- raw: the original statement description line, verbatim, otherwise null.',
    categoryList
      ? `- category: your best guess of the spending category for this merchant, chosen verbatim from this list (or null if unsure): ${categoryList}. Do not invent categories outside the list.`
      : '- category: null (no category list provided).',
    '- Do NOT include the cardholder name — the person is chosen in the app.',
    '- Skip non-transaction rows: opening/closing balances, interest lines, section headers, subtotals, and totals.',
    '- If you are given multiple screenshots that OVERLAP, include each real transaction only once — do not repeat a row that appears in two screenshots.',
    '- But if the SAME purchase genuinely happened more than once (e.g. two separate identical charges that day), include it that many times — each real charge is its own object.',
  ].join('\n');
}
