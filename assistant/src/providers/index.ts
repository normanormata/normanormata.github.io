// Models are configured as "provider/model-id": google/gemini-3.8-flash,
// fireworks/accounts/fireworks/models/kimi-k2p6, workers-ai/@cf/openai/gpt-oss-120b.

import { googleProvider } from './google.ts';
import { HOSTS, openAICompatibleProvider, type HostName } from './openai-compatible.ts';
import { workersAIProvider } from './workers-ai.ts';
import { mockProvider } from './mock.ts';
import { ProviderError, type Provider, type Usage } from './types.ts';

export interface ProviderEnv {
  AI?: Ai;
  GEMINI_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
}

interface ModelInfo {
  name: string;
  host: string;
  /** Standard paid prices in US$ per million tokens, from the providers' pricing pages (2026-09-22). */
  input: number;
  output: number;
}

// Known models: display names, and prices for the cost figures in the model
// test's report. Anything not listed still works; it just shows its raw ID.
const MODELS: Record<string, ModelInfo> = {
  'google/gemini-3.8-flash': { name: 'Gemini 3.8 Flash', host: 'Google', input: 0.75, output: 3.75 },
  'google/gemini-3.5-flash-lite': { name: 'Gemini 3.5 Flash-Lite', host: 'Google', input: 0.3, output: 2.5 },
  'fireworks/accounts/fireworks/models/gpt-oss-120b': { name: 'gpt-oss-120b', host: 'Fireworks', input: 0.15, output: 0.6 },
  'fireworks/accounts/fireworks/models/glm-5p3-flash': { name: 'GLM 5.3 Flash', host: 'Fireworks', input: 0.15, output: 0.5 },
  'fireworks/accounts/fireworks/models/deepseek-v4p1-flash': { name: 'DeepSeek V4.1 Flash', host: 'Fireworks', input: 0.3, output: 1.2 },
  'fireworks/accounts/fireworks/models/kimi-k2p6': { name: 'Kimi K2.6', host: 'Fireworks', input: 0.95, output: 4 },
  'fireworks/accounts/fireworks/models/deepseek-v4-pro-0813': { name: 'DeepSeek V4 Pro', host: 'Fireworks', input: 1.32, output: 3.96 },
  'workers-ai/@cf/openai/gpt-oss-120b': { name: 'gpt-oss-120b', host: 'Cloudflare', input: 0.35, output: 0.75 },
};

function split(id: string): { provider: string; model: string } {
  const slash = id.indexOf('/');
  if (slash <= 0) throw new ProviderError(`Model "${id}" must be written as provider/model-id`);
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

export function providerFor(id: string, env: ProviderEnv, allowMock = false): Provider {
  const { provider, model } = split(id);
  if (provider === 'mock' && allowMock) return mockProvider(id, model);
  if (provider === 'google') return googleProvider(id, model, env.GEMINI_API_KEY);
  if (provider === 'workers-ai') return workersAIProvider(id, model, env.AI);
  if (provider in HOSTS) {
    const host = provider as HostName;
    return openAICompatibleProvider(id, host, model, env[HOSTS[host].keyName]);
  }
  throw new ProviderError(`Unknown provider "${provider}" in model "${id}"`);
}

/** "Gemini 3.8 Flash (Google)", or the model's own ID when it isn't listed. */
export function describeModel(id: string): string {
  const known = MODELS[id];
  if (known) return `${known.name} (${known.host})`;
  const model = id.slice(id.lastIndexOf('/') + 1);
  return model || id;
}

/** What `usage` would cost at the listed paid price, or null for an unlisted model. */
export function costOf(id: string, usage: Usage): number | null {
  const known = MODELS[id];
  if (!known) return null;
  return (usage.inputTokens * known.input + usage.outputTokens * known.output) / 1_000_000;
}
