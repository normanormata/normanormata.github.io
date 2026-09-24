// Open models on Cloudflare Workers AI, through the Worker's AI binding. This is
// the backup: free within the daily allowance (10,000 Neurons), after which the
// Free plan fails the call instead of billing. It answers in one piece rather
// than streaming, which keeps the backup simple.

import { ProviderError, isRetryableStatus, NO_USAGE, stripThinking, type Provider, type Usage } from './types.ts';

interface ChatOutput {
  choices?: Array<{ message?: { content?: string | null } }>;
  response?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function textOf(output: ChatOutput): string {
  return output.choices?.[0]?.message?.content ?? output.response ?? '';
}

function usageOf(output: ChatOutput): Usage {
  if (!output.usage) return NO_USAGE;
  return { inputTokens: output.usage.prompt_tokens ?? 0, outputTokens: output.usage.completion_tokens ?? 0 };
}

function wrap(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const status = (error as { status?: number })?.status;
  return new ProviderError(
    `Workers AI: ${error instanceof Error ? error.message : String(error)}`,
    status,
    isRetryableStatus(status),
  );
}

export function workersAIProvider(id: string, model: string, ai: Ai | undefined): Provider {
  if (!ai) throw new ProviderError('The AI binding is missing', undefined, false);
  // The binding is typed per model; this module takes any chat model by name.
  const run = ai.run.bind(ai) as unknown as (model: string, inputs: object) => Promise<ChatOutput>;

  return {
    id,
    async plan({ system, prompt, schema }) {
      try {
        const output = await run(model, {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'plan', schema } },
          reasoning_effort: 'low',
          max_tokens: 1024,
        });
        return { text: textOf(output), usage: usageOf(output) };
      } catch (error) {
        throw wrap(error);
      }
    },

    async answer({ system, turns, onText }) {
      try {
        const output = await run(model, {
          messages: [{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role, content: t.text }))],
          reasoning_effort: 'low',
          max_tokens: 4096,
        });
        const text = stripThinking(textOf(output));
        if (!text) throw new ProviderError('Workers AI: empty answer', undefined, false);
        onText(text);
        return { usage: usageOf(output) };
      } catch (error) {
        throw wrap(error);
      }
    },
  };
}
