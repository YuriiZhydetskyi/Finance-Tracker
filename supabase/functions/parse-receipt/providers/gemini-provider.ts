import { buildPrompt, buildSchema } from '../prompts/receipt-prompt.ts';
import {
  buildBulkPrompt,
  buildBulkRepairPrompt,
  buildBulkRepairSchema,
  buildBulkSchema,
} from '../prompts/bulk-import-prompt.ts';
import type {
  AiContext,
  BulkParsedDocument,
  BulkReceiptItemRepair,
  BulkReceiptRepairContext,
  ParsedReceipt,
} from '../types.ts';
import type { IAiProvider } from './ai-provider.ts';

const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.7-flash';
const THINKING_LEVEL = 'low';
const IMAGE_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH';
const PDF_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_MEDIUM';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

type Config = { apiKey: string; model?: string; timeoutMs?: number };

export class GeminiProvider implements IAiProvider {
  readonly name = 'gemini';

  constructor(private readonly cfg: Config) {}

  parse(imageBase64: string, ctx: AiContext): Promise<ParsedReceipt> {
    return this.request<ParsedReceipt>(imageBase64, ctx, buildPrompt(ctx), buildSchema(ctx));
  }

  parseBulk(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt = false,
  ): Promise<BulkParsedDocument> {
    return this.request<BulkParsedDocument>(
      imageBase64,
      ctx,
      buildBulkPrompt(ctx, forceReceipt),
      buildBulkSchema(ctx),
    );
  }

  repairBulkItems(
    imageBase64: string,
    ctx: AiContext,
    repair: BulkReceiptRepairContext,
  ): Promise<BulkReceiptItemRepair> {
    return this.request<BulkReceiptItemRepair>(
      imageBase64,
      ctx,
      buildBulkRepairPrompt(ctx, repair),
      buildBulkRepairSchema(ctx),
    );
  }

  private async request<T>(
    imageBase64: string,
    ctx: AiContext,
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const model = this.cfg.model ?? DEFAULT_MODEL;
    const url = `${GEMINI_API_URL_BASE}/${model}:generateContent`;
    // Keep the media budget explicit: Gemini recommends High for image analysis
    // and Medium for ordinary PDF document OCR.
    const mediaResolution =
      ctx.mimeType === 'application/pdf' ? PDF_MEDIA_RESOLUTION : IMAGE_MEDIA_RESOLUTION;
    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: { mime_type: ctx.mimeType, data: imageBase64 },
              media_resolution: { level: mediaResolution },
            },
          ],
        },
      ],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVEL },
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API ${res.status}: ${text.slice(0, 500)}`);
    }

    const wrapper: unknown = await res.json();
    const text = extractText(wrapper);
    if (!text) {
      throw new Error(`Gemini returned no text: ${JSON.stringify(wrapper).slice(0, 500)}`);
    }
    return JSON.parse(text) as T;
  }
}

function extractText(wrapper: unknown): string | null {
  if (!wrapper || typeof wrapper !== 'object') return null;
  const candidates = (wrapper as { candidates?: unknown[] }).candidates;
  const first = candidates?.[0];
  if (!first || typeof first !== 'object') return null;
  const content = (first as { content?: { parts?: unknown[] } }).content;
  const parts = content?.parts;
  if (!parts) return null;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const candidate = part as { text?: unknown; thought?: unknown };
    // Thinking output is not the structured receipt. Gemini can place it ahead
    // of the JSON part, so select the first non-thought text part instead.
    if (candidate.thought === true) continue;
    if (typeof candidate.text === 'string') return candidate.text;
  }
  return null;
}
