export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Provider {
  /** "provider/model-id", as configured. */
  readonly id: string;
  /** One JSON reply for the planning step. */
  plan(args: { system: string; prompt: string; schema: object }): Promise<{ text: string; usage: Usage }>;
  /** The answer, streamed through `onText` as it is written. */
  answer(args: { system: string; turns: Turn[]; onText: (delta: string) => void }): Promise<{ usage: Usage }>;
}

/** A provider call that failed. `retryable` failures (limits, quotas, outages) go to the backup model. */
export class ProviderError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

const OPEN = '<think>';
const CLOSE = '</think>';

/** Length of the longest end of `text` that could be the start of `tag`. */
function partialTag(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/**
 * Drops <think>…</think> blocks from streamed text. Most hosts return reasoning
 * separately, but some open models write it inline.
 */
export function thinkFilter(emit: (text: string) => void): { push: (delta: string) => void; flush: () => void } {
  let inside = false;
  let buffer = '';
  return {
    push(delta: string) {
      buffer += delta;
      let out = '';
      for (;;) {
        if (inside) {
          const end = buffer.indexOf(CLOSE);
          if (end === -1) {
            buffer = buffer.slice(buffer.length - partialTag(buffer, CLOSE));
            break;
          }
          buffer = buffer.slice(end + CLOSE.length);
          inside = false;
        } else {
          const start = buffer.indexOf(OPEN);
          if (start === -1) {
            const keep = partialTag(buffer, OPEN);
            out += buffer.slice(0, buffer.length - keep);
            buffer = buffer.slice(buffer.length - keep);
            break;
          }
          out += buffer.slice(0, start);
          buffer = buffer.slice(start + OPEN.length);
          inside = true;
        }
      }
      if (out) emit(out);
    },
    flush() {
      if (!inside && buffer) emit(buffer);
      buffer = '';
    },
  };
}

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}
