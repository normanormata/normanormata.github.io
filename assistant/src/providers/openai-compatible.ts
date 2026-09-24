// Hosts that speak OpenAI's Chat Completions API, through the `openai` SDK.
// Adding one (Groq, Together, OpenRouter, …) is a row in HOSTS plus its key.
//
// Fireworks keeps no prompt or answer data on Chat Completions; its Responses
// API does keep conversation data, so this deliberately uses Chat Completions.

import OpenAI from 'openai';
import { ProviderError, isRetryableStatus, NO_USAGE, thinkFilter, type Provider, type Usage } from './types.ts';

export const HOSTS = {
  fireworks: { baseURL: 'https://api.fireworks.ai/inference/v1', keyName: 'FIREWORKS_API_KEY', label: 'Fireworks' },
} as const;

export type HostName = keyof typeof HOSTS;

function usageOf(usage: OpenAI.CompletionUsage | null | undefined): Usage {
  if (!usage) return NO_USAGE;
  return { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
}

// Reasoning models on Fireworks spend their whole token allowance thinking unless
// told not to, and then return nothing (Kimi K2.6 and DeepSeek V4 did, even with
// a JSON response_format). Ask for no reasoning; models that can't switch it
// off (GLM 5.3, gpt-oss) reject "none", so they get "low". Remembered per model.
type Effort = 'none' | 'low';
const effortFor = new Map<string, Effort>();

async function withEffort<T>(model: string, call: (effort: Effort) => Promise<T>): Promise<T> {
  const first = effortFor.get(model) ?? 'none';
  try {
    const result = await call(first);
    effortFor.set(model, first);
    return result;
  } catch (error) {
    if (first === 'none' && error instanceof OpenAI.BadRequestError && /reason|think/i.test(error.message)) {
      effortFor.set(model, 'low');
      return call('low');
    }
    throw error;
  }
}

function wrap(host: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof OpenAI.APIError) {
    return new ProviderError(`${host}: ${error.message}`, error.status, isRetryableStatus(error.status));
  }
  return new ProviderError(`${host}: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
}

export function openAICompatibleProvider(
  id: string,
  host: HostName,
  model: string,
  apiKey: string | undefined,
): Provider {
  const { baseURL, keyName, label } = HOSTS[host];
  if (!apiKey) throw new ProviderError(`${keyName} is not set`, undefined, true);
  // One retry inside the SDK; after that the backup model is quicker than waiting.
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 1, timeout: 60_000 });

  return {
    id,
    async plan({ system, prompt, schema }) {
      try {
        const completion = await withEffort(model, (effort) =>
          client.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'plan', schema: schema as Record<string, unknown> } },
            reasoning_effort: effort,
            max_tokens: 2048,
            temperature: 0,
          }),
        );
        const choice = completion.choices[0];
        const text = choice?.message?.content ?? '';
        if (!text.trim()) {
          throw new ProviderError(`${label}: empty plan (finish reason ${choice?.finish_reason ?? 'unknown'})`, undefined, true);
        }
        return { text, usage: usageOf(completion.usage) };
      } catch (error) {
        throw wrap(label, error);
      }
    },

    async answer({ system, turns, onText }) {
      try {
        const stream = await withEffort(model, (effort) =>
          client.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: system },
              ...turns.map((turn) => ({ role: turn.role, content: turn.text })),
            ],
            stream: true,
            reasoning_effort: effort,
            max_tokens: 4096,
            temperature: 0.2,
          }),
        );
        const filter = thinkFilter(onText);
        let usage = NO_USAGE;
        for await (const chunk of stream) {
          // Only the answer: hosts put reasoning in a separate `reasoning_content` field.
          const text = chunk.choices[0]?.delta?.content;
          if (text) filter.push(text);
          if (chunk.usage) usage = usageOf(chunk.usage);
        }
        filter.flush();
        return { usage };
      } catch (error) {
        throw wrap(label, error);
      }
    },
  };
}
