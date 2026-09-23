import { AiProviderError } from '../_shared/receipt-ai/providers/ai-provider.ts';
import { RetryableImportError } from './types.ts';

export function providerPublicMessage(error: unknown): string {
  if (!(error instanceof AiProviderError)) {
    return 'Незалежна модель повернула невалідний результат.';
  }
  if (error.code === 'incomplete_response') {
    if (error.trace.stopReason === 'max_tokens') {
      return `Відповідь ${error.trace.provider} досягла ліміту max_tokens; частковий структурований результат не прийнято.`;
    }
    return `Відповідь ${error.trace.provider} обірвалася (${error.trace.stopReason ?? 'unknown'}).`;
  }
  if (error.code === 'missing_output' || error.code === 'invalid_json') {
    return `Відповідь ${error.trace.provider} не містить повних структурованих даних.`;
  }
  if (error.code === 'timeout') {
    return `Час очікування відповіді ${error.trace.provider} вичерпано.`;
  }
  return `Provider ${error.trace.provider} не завершив аналіз.`;
}

export function joinReviewMessages(primaryMessage: string, diagnostic: string | null): string {
  return diagnostic ? `${primaryMessage} ${diagnostic}`.slice(0, 4000) : primaryMessage;
}

export function publicError(error: unknown): string {
  if (error instanceof RetryableImportError) return error.message;
  if (error instanceof AiProviderError) return providerPublicMessage(error);
  const message = error instanceof Error ? error.message : 'Unknown processing failure';
  const safePrefixes = [
    'Import file metadata unavailable',
    'Stored document download failed',
    'Category lookup failed',
    'AI result',
    'Invalid item',
    'Item ',
    'Unsupported currency or date',
    'NBU rate unavailable',
    'Receipt finalization failed',
    'Exception result could not be persisted',
  ];
  if (safePrefixes.some((prefix) => message.startsWith(prefix))) return message.slice(0, 4000);
  return 'AI provider or document processing failed.';
}
