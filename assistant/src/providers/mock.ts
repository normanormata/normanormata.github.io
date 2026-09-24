// Stand-in models for local development without API keys. Only reachable when
// ALLOW_MODEL_OVERRIDE is "true" (set in .dev.vars, never in production).
//   mock/echo  answers by citing the first sections it was given
//   mock/fail  fails like a provider at its rate limit, to exercise the backup

import { NO_USAGE, ProviderError, type Provider } from './types.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function mockProvider(id: string, model: string): Provider {
  if (model === 'fail') {
    const fail = async (): Promise<never> => {
      throw new ProviderError('Mock: rate limited', 429, true);
    };
    return { id, plan: fail, answer: fail };
  }
  if (model !== 'echo') throw new ProviderError(`Unknown mock model "${model}"`);

  return {
    id,
    async plan() {
      return { text: '{"references": [], "searches": []}', usage: NO_USAGE };
    },
    async answer({ turns, onText }) {
      const prompt = turns[turns.length - 1]?.text ?? '';
      const labels = [...prompt.matchAll(/^\[([^\]]+)\] /gm)].map((m) => m[1]).slice(0, 3);
      const text = labels.length
        ? `This is a test answer from the mock model, not a real one. It cites ${labels.map((l) => `[${l}]`).join(', ')} so the links can be checked.\n\nA second paragraph shows how longer answers wrap and how an unknown citation such as [WCF 99.9] stays plain text.`
        : 'The mock model found no sections for this question.';
      for (const piece of text.split(/(?<= )/)) {
        onText(piece);
        await pause(12);
      }
      return { usage: NO_USAGE };
    },
  };
}
