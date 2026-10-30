// Names the import prompt asks the AI to use for «Інше» (ADR-0035) and the add form
// suggests, so cards filled by an import and by hand end up with the same keys.
// Suggestions only: any other name is stored as typed.
export const SUGGESTED_ATTRIBUTE_KEYS = [
  'Сорт',
  'Калібр',
  'Клас',
  'Країна походження',
  'Виробник',
  'Умови зберігання',
  'Сертифікація',
] as const;
