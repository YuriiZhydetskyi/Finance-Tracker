// `cn` — combine class strings, deduplicating Tailwind utilities. Standard
// Tailwind helper. Use `cn('px-4', condition && 'bg-red-500', overrideProp)`.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
