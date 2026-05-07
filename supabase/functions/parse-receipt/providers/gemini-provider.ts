import { buildPrompt, buildSchema } from '../prompts/receipt-prompt.ts';
import type { AiContext, ParsedReceipt } from '../types.ts';
import type { IAiProvider } from './ai-provider.ts';

const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const TEMPERATURE = 0.1;

type Config = { apiKey: string; model?: string };

export class GeminiProvider implements IAiProvider {
  readonly name = 'gemini';

  constructor(private readonly cfg: Config) {}

  async parse(imageBase64: string, ctx: AiContext): Promise<ParsedReceipt> {
    const model = this.cfg.model ?? DEFAULT_MODEL;
    const url = `${GEMINI_API_URL_BASE}/${model}:generateContent`;
    const body = {
      contents: [
        {
          parts: [
            { text: buildPrompt(ctx) },
            { inline_data: { mime_type: ctx.mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: TEMPERATURE,
        responseMimeType: 'application/json',
        responseJsonSchema: buildSchema(ctx),
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.cfg.apiKey },
      body: JSON.stringify(body),
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
    return JSON.parse(text) as ParsedReceipt;
  }
}

function extractText(wrapper: unknown): string | null {
  if (!wrapper || typeof wrapper !== 'object') return null;
  const candidates = (wrapper as { candidates?: unknown[] }).candidates;
  const first = candidates?.[0];
  if (!first || typeof first !== 'object') return null;
  const content = (first as { content?: { parts?: unknown[] } }).content;
  const parts = content?.parts;
  const part = parts?.[0];
  if (!part || typeof part !== 'object') return null;
  const text = (part as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
}
