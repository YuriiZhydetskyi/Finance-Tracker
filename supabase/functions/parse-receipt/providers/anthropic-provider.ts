import { buildPrompt, buildSchema } from '../prompts/receipt-prompt.ts';
import type { AiContext, ParsedReceipt } from '../types.ts';
import type { IAiProvider } from './ai-provider.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.1;
const TOOL_NAME = 'record_receipt';

type Config = { apiKey: string; model?: string };

export class AnthropicProvider implements IAiProvider {
  readonly name = 'anthropic';

  constructor(private readonly cfg: Config) {}

  async parse(imageBase64: string, ctx: AiContext): Promise<ParsedReceipt> {
    const body = {
      model: this.cfg.model ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Record the parsed receipt fields and line items.',
          input_schema: buildSchema(ctx),
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: ctx.mimeType, data: imageBase64 },
            },
            { type: 'text', text: buildPrompt(ctx) },
          ],
        },
      ],
    };

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
    }

    const wrapper: unknown = await res.json();
    const input = extractToolInput(wrapper);
    if (!input) {
      throw new Error(
        `Anthropic returned no tool_use block: ${JSON.stringify(wrapper).slice(0, 500)}`,
      );
    }
    return input as ParsedReceipt;
  }
}

function extractToolInput(wrapper: unknown): Record<string, unknown> | null {
  if (!wrapper || typeof wrapper !== 'object') return null;
  const blocks = (wrapper as { content?: unknown[] }).content;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; name?: unknown; input?: unknown };
    if (b.type === 'tool_use' && b.name === TOOL_NAME && b.input && typeof b.input === 'object') {
      return b.input as Record<string, unknown>;
    }
  }
  return null;
}
