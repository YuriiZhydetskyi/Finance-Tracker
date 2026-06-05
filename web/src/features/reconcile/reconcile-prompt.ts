// Prompt the user copies into an external AI tool to turn card-statement
// screenshots into JSON our import dialog can validate. Mirrors the receipt
// import prompt; the cardholder is intentionally NOT extracted (chosen in-app).

export const STATEMENT_EXAMPLE_JSON = `{
  "transactions": [
    {
      "date": "2026-05-25",
      "amount": 12.34,
      "currency": "EUR",
      "time": null,
      "merchant": "Lidl",
      "raw": "LIDL DIENSTLEISTUNG SAGT DANKE"
    }
  ]
}`;

export function buildStatementPrompt(): string {
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
    '- Do NOT include the cardholder name — the person is chosen in the app.',
    '- Skip non-transaction rows: opening/closing balances, interest lines, section headers, subtotals, and totals.',
  ].join('\n');
}
