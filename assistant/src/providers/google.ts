// Gemini through Google's own SDK. On a free-tier key (a Google project with no
// billing) every call is free within Google's limits; past them Google returns
// 429 RESOURCE_EXHAUSTED, which sends the question to the backup model.

import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentResponseUsageMetadata } from '@google/genai';
import { ProviderError, isRetryableStatus, NO_USAGE, type Provider, type Usage } from './types.ts';

function usageOf(metadata: GenerateContentResponseUsageMetadata | undefined): Usage {
  if (!metadata) return NO_USAGE;
  return {
    inputTokens: metadata.promptTokenCount ?? 0,
    outputTokens: (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
  };
}

function wrap(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof ApiError) {
    return new ProviderError(`Gemini: ${error.message}`, error.status, isRetryableStatus(error.status));
  }
  return new ProviderError(`Gemini: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
}

export function googleProvider(id: string, model: string, apiKey: string | undefined): Provider {
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY is not set', undefined, true);
  const ai = new GoogleGenAI({ apiKey });

  return {
    id,
    async plan({ system, prompt, schema }) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            maxOutputTokens: 2048,
            temperature: 0,
          },
        });
        return { text: response.text ?? '', usage: usageOf(response.usageMetadata) };
      } catch (error) {
        throw wrap(error);
      }
    },

    async answer({ system, turns, onText }) {
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents: turns.map((turn) => ({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.text }],
          })),
          config: {
            systemInstruction: system,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            maxOutputTokens: 4096,
            temperature: 0.2,
          },
        });
        let usage = NO_USAGE;
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) onText(text);
          if (chunk.usageMetadata) usage = usageOf(chunk.usageMetadata);
        }
        return { usage };
      } catch (error) {
        throw wrap(error);
      }
    },
  };
}
