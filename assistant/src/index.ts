// The Ask assistant for creedsandconfessions.com.
//
//   GET  /info  the models in use and the data notice the Ask page shows
//   POST /ask   { question, history?, about? } -> a stream of server-sent events:
//               status, sources, text, done, error
//
// Each question takes three steps: a planning call proposes citations and search
// phrases, the Worker looks them up in the site's own section index, and the
// answering call writes from those sections alone. If a model fails before it
// has written anything (a limit, a quota, an outage), the backup model takes over.

import { DurableObject } from 'cloudflare:workers';
import { findReferences, loadCorpus, type Corpus, type Section } from './corpus.ts';
import { ANSWER_SYSTEM, PLAN_SCHEMA, PLANNER_SYSTEM, answerPrompt, parsePlan, planPrompt, sectionChars, type Plan } from './prompts.ts';
import { costOf, describeModel, providerFor } from './providers/index.ts';
import type { Turn, Usage } from './providers/types.ts';

// Secrets and development settings come from .dev.vars or `wrangler secret`, so
// `wrangler types` only sees them when a .dev.vars exists: declare them here
// either way.
interface AppEnv extends Omit<Env, 'GEMINI_API_KEY' | 'FIREWORKS_API_KEY' | 'ALLOW_MODEL_OVERRIDE'> {
  GEMINI_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
  /** "true" only in .dev.vars: accepts X-Model headers and the mock models. */
  ALLOW_MODEL_OVERRIDE?: string;
}

const MAX_QUESTION_CHARS = 1000;
const MAX_TURNS = 6;
const MAX_HISTORY_CHARS = 8000;
const MAX_SECTIONS = 10;
const MAX_PLANNED_SECTIONS = 7;
const MAX_CONTEXT_CHARS = 20000;

interface Question {
  question: string;
  history: Turn[];
  about?: string;
}

/** Counts questions per UTC day across the whole site. */
export class DailyCounter extends DurableObject {
  async take(day: string, limit: number): Promise<boolean> {
    const stored = await this.ctx.storage.get<{ day: string; count: number }>('today');
    const count = stored?.day === day ? stored.count : 0;
    if (count >= limit) return false;
    await this.ctx.storage.put('today', { day, count: count + 1 });
    return true;
  }
}

function allowedOrigin(origin: string | null, env: AppEnv): string | null {
  if (!origin) return null;
  const allowed = String(env.ALLOWED_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function refuse(status: number, error: string, message: string, headers: Record<string, string>): Response {
  return json({ error, message }, status, headers);
}

/** The request body, checked; a string is the reason it was rejected. */
function readQuestion(body: unknown): Question | string {
  if (!body || typeof body !== 'object') return 'Send a question.';
  const { question, history, about } = body as Record<string, unknown>;
  if (typeof question !== 'string' || !question.trim()) return 'Send a question.';
  if (question.length > MAX_QUESTION_CHARS) return `Questions can be up to ${MAX_QUESTION_CHARS} characters.`;

  const turns: Turn[] = [];
  if (history !== undefined) {
    if (!Array.isArray(history)) return 'The conversation history is malformed.';
    for (const item of history.slice(-MAX_TURNS)) {
      const { role, text } = (item ?? {}) as Record<string, unknown>;
      if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') {
        return 'The conversation history is malformed.';
      }
      turns.push({ role, text: text.slice(0, 4000) });
    }
    // The model expects the conversation to open with the reader, and the new
    // question is the next user turn, so the history must end with an answer.
    while (turns.length && turns[0].role !== 'user') turns.shift();
    while (turns.length && turns[turns.length - 1].role !== 'assistant') turns.pop();
    let chars = turns.reduce((sum, t) => sum + t.text.length, 0);
    while (chars > MAX_HISTORY_CHARS && turns.length >= 2) {
      chars -= turns[0].text.length + turns[1].text.length;
      turns.splice(0, 2);
    }
  }

  return {
    question: question.trim(),
    history: turns,
    about: typeof about === 'string' && about.trim() ? about.trim().slice(0, 40) : undefined,
  };
}

/**
 * The sections to answer from: the one being read, citations written into the
 * question, the planner's citations, then keyword matches.
 */
function retrieve(corpus: Corpus, input: Question, plan: Plan): Section[] {
  const picked: Section[] = [];
  const seen = new Set<string>();
  let chars = 0;
  const take = (section: Section, cap: number) => {
    if (picked.length >= cap || seen.has(section.key)) return;
    const size = sectionChars(section);
    if (picked.length > 0 && chars + size > MAX_CONTEXT_CHARS) return;
    seen.add(section.key);
    picked.push(section);
    chars += size;
  };

  if (input.about) corpus.lookup(input.about, 2).forEach((s) => take(s, 2));
  for (const reference of [...findReferences(input.question), ...plan.references]) {
    corpus.lookup(reference, 4).forEach((s) => take(s, MAX_PLANNED_SECTIONS));
  }
  for (const query of [...plan.searches, input.question]) {
    corpus.search(query, 3).forEach((s) => take(s, MAX_SECTIONS));
  }
  return picked;
}

interface Models {
  main: string;
  plan: string;
  fallback: string | null;
}

function modelsFor(request: Request, env: AppEnv): Models {
  const models: Models = {
    main: String(env.MODEL),
    plan: String(env.PLAN_MODEL || env.MODEL),
    fallback: env.FALLBACK_MODEL ? String(env.FALLBACK_MODEL) : null,
  };
  if (env.ALLOW_MODEL_OVERRIDE === 'true') {
    const main = request.headers.get('X-Model');
    const plan = request.headers.get('X-Plan-Model');
    const fallback = request.headers.get('X-Fallback-Model');
    if (main) models.main = main;
    if (plan || main) models.plan = plan || main || models.plan;
    if (fallback) models.fallback = fallback === 'none' ? null : fallback;
  }
  return models;
}

type Send = (event: string, data: unknown) => void;

async function answer(input: Question, models: Models, env: AppEnv, send: Send): Promise<void> {
  const started = Date.now();
  const dev = env.ALLOW_MODEL_OVERRIDE === 'true';
  const usage: Record<string, Usage> = {};
  const add = (id: string, u: Usage) => {
    const before = usage[id] ?? { inputTokens: 0, outputTokens: 0 };
    usage[id] = { inputTokens: before.inputTokens + u.inputTokens, outputTokens: before.outputTokens + u.outputTokens };
  };
  const failures: string[] = [];

  send('status', { message: 'Finding the sections that bear on your question…' });
  const corpus = await loadCorpus(String(env.CORPUS_URL));

  // 1. Plan. If every planner fails, keyword search alone still finds something.
  let plan: Plan = { references: [], searches: [] };
  let planModel: string | null = null;
  const previousQuestion = [...input.history].reverse().find((t) => t.role === 'user')?.text;
  for (const id of [models.plan, models.fallback]) {
    if (!id) continue;
    try {
      const result = await providerFor(id, env, dev).plan({
        system: PLANNER_SYSTEM,
        prompt: planPrompt(input.question, input.about, previousQuestion),
        schema: PLAN_SCHEMA,
      });
      add(id, result.usage);
      plan = parsePlan(result.text);
      planModel = id;
      break;
    } catch (error) {
      failures.push(`plan ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2. Retrieve.
  const sections = retrieve(corpus, input, plan);
  send('sources', sections.map((s) => ({ reference: s.label, title: s.title, document: s.document, url: s.url })));
  send('status', {
    message: sections.length
      ? `Reading ${sections.slice(0, 4).map((s) => s.label).join(', ')}${sections.length > 4 ? ` and ${sections.length - 4} more` : ''}…`
      : 'No sections matched; asking anyway…',
  });

  // 3. Answer, falling back only if nothing has been written yet.
  const turns: Turn[] = [...input.history, { role: 'user', text: answerPrompt(input.question, sections, input.about) }];
  let answeredBy: string | null = null;
  let wrote = false;
  for (const id of [models.main, models.fallback]) {
    if (!id) continue;
    try {
      const result = await providerFor(id, env, dev).answer({
        system: ANSWER_SYSTEM,
        turns,
        onText: (delta) => {
          wrote = true;
          // gpt-oss writes citations as 【WCF 1.1】; the page and the history expect [WCF 1.1].
          send('text', { delta: delta.replace(/【/g, '[').replace(/】/g, ']') });
        },
      });
      add(id, result.usage);
      answeredBy = id;
      break;
    } catch (error) {
      failures.push(`answer ${id}: ${error instanceof Error ? error.message : String(error)}`);
      if (wrote) break;
    }
  }

  const totals = Object.values(usage).reduce(
    (sum, u) => ({ inputTokens: sum.inputTokens + u.inputTokens, outputTokens: sum.outputTokens + u.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );
  // Logged without the question: which models ran, what it cost, how long it took.
  console.log(JSON.stringify({
    event: answeredBy ? 'answered' : 'failed',
    plan_model: planModel,
    answer_model: answeredBy,
    fallback: answeredBy !== null && answeredBy !== models.main,
    sections: sections.length,
    planned: plan.references.length,
    ...totals,
    ms: Date.now() - started,
    failures,
  }));

  if (!answeredBy) {
    send('error', {
      error: wrote ? 'interrupted' : 'busy',
      message: wrote
        ? 'The answer was cut off partway. Please ask again.'
        : 'The assistant is busy right now. Please try again in a few minutes.',
    });
    return;
  }

  const cost = Object.entries(usage).reduce<number | null>((sum, [id, u]) => {
    const c = costOf(id, u);
    return sum === null || c === null ? null : sum + c;
  }, 0);
  send('done', {
    model: describeModel(answeredBy),
    fallback: answeredBy !== models.main,
    ...(dev ? { usage, cost, plan, planModel, failures, ms: Date.now() - started } : {}),
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get('Origin'), env);
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/info' && request.method === 'GET') {
      return json(
        {
          model: describeModel(String(env.MODEL)),
          fallback: env.FALLBACK_MODEL ? describeModel(String(env.FALLBACK_MODEL)) : null,
          notice: env.DATA_NOTICE,
          maxQuestionChars: MAX_QUESTION_CHARS,
        },
        200,
        cors,
      );
    }

    if (url.pathname !== '/ask') return refuse(404, 'not_found', 'Not found.', cors);
    if (request.method !== 'POST') return refuse(405, 'method', 'Use POST.', { ...cors, Allow: 'POST, OPTIONS' });
    if (!origin) return refuse(403, 'forbidden', 'This assistant answers questions from creedsandconfessions.com.', cors);

    // The model test sends X-Model-Test to skip the visitor limits; honored only
    // with ALLOW_MODEL_OVERRIDE, which is set in .dev.vars and never deployed.
    const modelTest = env.ALLOW_MODEL_OVERRIDE === 'true' && request.headers.get('X-Model-Test') === '1';

    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    if (!modelTest && !(await env.ASK_LIMITER.limit({ key: ip })).success) {
      return refuse(429, 'too_many', 'You’ve asked several questions in a row. Please wait a minute and try again.', { ...cors, 'Retry-After': '60' });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse(400, 'bad_request', 'Send a question.', cors);
    }
    const input = readQuestion(body);
    if (typeof input === 'string') return refuse(400, 'bad_request', input, cors);

    const limit = Number(env.DAILY_LIMIT) || 200;
    const day = new Date().toISOString().slice(0, 10);
    const counter = env.DAILY_COUNTER.get(env.DAILY_COUNTER.idFromName('site'));
    if (!modelTest && !(await counter.take(day, limit))) {
      return refuse(429, 'resting', 'The assistant has answered as many questions as it can today. Please try again tomorrow.', cors);
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send: Send = (event, data) => {
      writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});
    };

    const models = modelsFor(request, env);
    ctx.waitUntil(
      answer(input, models, env, send)
        .catch((error: unknown) => {
          console.log(JSON.stringify({ event: 'error', message: error instanceof Error ? error.message : String(error) }));
          send('error', { error: 'failed', message: 'Something went wrong while answering. Please try again.' });
        })
        .finally(() => writer.close().catch(() => {})),
    );

    return new Response(readable, {
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
} satisfies ExportedHandler<AppEnv>;
