#!/usr/bin/env node
// The model test. Asks every question in test/questions.json of each candidate
// setup, through a local Worker, and writes a side-by-side report to
// comparison/<date>.md (plus the raw results as .json).
//
//   npm run dev          # terminal 1: needs .dev.vars with keys and ALLOW_MODEL_OVERRIDE=true
//   npm run compare      # terminal 2
//   npm run compare -- --only gemini-flash,fireworks-kimi --questions chief-end,pope
//   npm run compare -- --from comparison/a.json,comparison/b.json   # re-score and merge saved runs
//
// The backup model is switched off during the test, so a model that fails shows
// as failed instead of being quietly answered by the backup. Each provider gets
// its own lane, paced under its free limits: Fireworks allows 10 requests a
// minute before a card is added, Gemini's free tier roughly 10–15 per model,
// and each question takes two requests (plan, then answer).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CANDIDATES = [
  { id: 'gemini-flash', lane: 'google', perMinute: 5, freeTier: true,
    label: 'Gemini 3.8 Flash, planned by Flash-Lite (Google free tier)',
    main: 'google/gemini-3.8-flash', plan: 'google/gemini-3.5-flash-lite' },
  { id: 'gemini-flash-lite', lane: 'google', perMinute: 4, freeTier: true,
    label: 'Gemini 3.5 Flash-Lite (Google free tier)',
    main: 'google/gemini-3.5-flash-lite' },
  { id: 'fireworks-gpt-oss', lane: 'fireworks', perMinute: 4,
    label: 'gpt-oss-120b (Fireworks)', main: 'fireworks/accounts/fireworks/models/gpt-oss-120b' },
  { id: 'fireworks-glm-flash', lane: 'fireworks', perMinute: 4,
    label: 'GLM 5.3 Flash (Fireworks)', main: 'fireworks/accounts/fireworks/models/glm-5p3-flash' },
  { id: 'fireworks-deepseek-flash', lane: 'fireworks', perMinute: 4,
    label: 'DeepSeek V4.1 Flash (Fireworks)', main: 'fireworks/accounts/fireworks/models/deepseek-v4p1-flash' },
  { id: 'fireworks-kimi', lane: 'fireworks', perMinute: 4,
    label: 'Kimi K2.6 (Fireworks)', main: 'fireworks/accounts/fireworks/models/kimi-k2p6' },
  { id: 'fireworks-deepseek-pro', lane: 'fireworks', perMinute: 4,
    label: 'DeepSeek V4 Pro (Fireworks)', main: 'fireworks/accounts/fireworks/models/deepseek-v4-pro-0813' },
  { id: 'cloudflare-gpt-oss', lane: 'cloudflare', perMinute: 10,
    label: 'gpt-oss-120b (Cloudflare Workers AI, the backup)', main: 'workers-ai/@cf/openai/gpt-oss-120b' },
];

const CITATION_LIKE = /^(WCF|WSC|WLC|Heidelberg|HC|Belgic|Dort|FG|BD|DPW)\b|Creed/i;

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const url = option('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const origin = option('origin', 'http://localhost:4000');
const only = option('only', '');
const onlyQuestions = option('questions', '');

// --mock: a dry run with the Worker's stand-in model, to check this script and
// the Worker end to end without using any provider.
const MOCK = [{ id: 'mock-echo', lane: 'mock', perMinute: 600, label: 'mock/echo (dry run)', main: 'mock/echo' }];

const suite = JSON.parse(readFileSync(new URL('../test/questions.json', import.meta.url), 'utf8'));
const questions = suite.questions.filter((q) => !onlyQuestions || onlyQuestions.split(',').includes(q.id));
const candidates = (process.argv.includes('--mock') ? MOCK : CANDIDATES)
  .filter((c) => !only || only.split(',').includes(c.id));
if (!questions.length || (!candidates.length && !process.argv.includes('--from'))) {
  console.error('Nothing to run: check --only and --questions.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (label) => String(label).toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim();

/** Posts one question and reads the event stream to the end. */
async function ask(candidate, question) {
  const started = Date.now();
  const result = { answer: '', sources: [], done: null, error: null, firstTextMs: null, ms: 0 };
  let response;
  try {
    response = await fetch(`${url}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Model-Test': '1',
        'X-Model': candidate.main,
        'X-Plan-Model': candidate.plan ?? candidate.main,
        'X-Fallback-Model': 'none',
      },
      body: JSON.stringify({ question: question.question }),
    });
  } catch (error) {
    result.error = `Could not reach the Worker at ${url}: ${error.message}. Is \`npm run dev\` running?`;
    return result;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    result.error = `HTTP ${response.status}: ${body.message ?? ''}`;
    return result;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || !data) continue;
      const value = JSON.parse(data);
      if (event === 'text') {
        if (result.firstTextMs === null) result.firstTextMs = Date.now() - started;
        result.answer += value.delta;
      } else if (event === 'sources') {
        result.sources = value;
      } else if (event === 'done') {
        result.done = value;
      } else if (event === 'error') {
        result.error = value.message;
      }
    }
  }
  result.ms = Date.now() - started;
  return result;
}

/** Bracketed citations in an answer, split into those the Worker supplied and the rest. */
function citations(answer, sources) {
  const byLabel = new Map(sources.map((s) => [normalize(s.reference), s.reference]));
  const cited = [];
  const unsupported = [];
  // Some models (gpt-oss) write 【WCF 1.1】 or (WCF 1.1) instead of [WCF 1.1].
  // Parentheses count only when a part names a supplied section, as on the page.
  const text = answer.replace(/【/g, '[').replace(/】/g, ']');
  for (const match of text.matchAll(/\[([^[\]]{1,80})\]|\(([^()]{1,80})\)/g)) {
    const bracket = match[1] !== undefined;
    const inner = bracket ? match[1] : match[2];
    if (!bracket && !inner.split(/\s*[;,]\s*/).some((part) => byLabel.has(normalize(part)))) continue;
    let prefix = '';
    for (const part of inner.split(/\s*[;,]\s*/)) {
      // A trailing proof letter ("WCF 1.6 m") or lettered sub-item ("DPW 1.A.4.a")
      // belongs to the section it follows.
      let label = byLabel.get(normalize(part)) ?? byLabel.get(normalize(part.replace(/[.\s]\s*[a-z]$/, '')));
      if (!label && prefix && /^[\d./]/.test(part)) label = byLabel.get(normalize(`${prefix} ${part}`));
      const lead = /^(.*?[A-Za-z’'])\s+\d/.exec(part);
      if (lead) prefix = lead[1];
      if (label) {
        if (!cited.includes(label)) cited.push(label);
      } else if (CITATION_LIKE.test(part) && !unsupported.includes(part)) {
        unsupported.push(part);
      }
    }
  }
  return { cited, unsupported };
}

function expectationHits(question, cited) {
  if (question.expectNone) return { hits: cited.length === 0 ? 1 : 0, total: 1 };
  const lowered = cited.map(normalize);
  const hits = question.expect.filter((expected) => {
    if (expected.endsWith('.*')) {
      const unit = normalize(expected.slice(0, -2));
      return lowered.some((label) => label === unit || label.startsWith(`${unit}.`));
    }
    return lowered.includes(normalize(expected));
  }).length;
  return { hits, total: question.expect.length };
}

async function runLane(lane) {
  const results = [];
  for (const candidate of candidates.filter((c) => c.lane === lane)) {
    const gap = 60_000 / candidate.perMinute;
    for (const question of questions) {
      const started = Date.now();
      let result = await ask(candidate, question);
      // A provider limit shows up as "busy" with fallback off: wait once and retry.
      if (result.error && /busy|429/i.test(result.error)) {
        console.log(`  ${candidate.id} / ${question.id}: rate limited, waiting a minute`);
        await sleep(61_000);
        result = await ask(candidate, question);
      }
      const { cited, unsupported } = citations(result.answer, result.sources);
      const expected = expectationHits(question, cited);
      results.push({ candidate: candidate.id, question: question.id, ...result, cited, unsupported, expected });
      const mark = result.error ? `FAILED (${result.error})` : `${expected.hits}/${expected.total} expected`;
      console.log(`${candidate.id.padEnd(26)} ${question.id.padEnd(18)} ${mark} ${(result.ms / 1000).toFixed(1)}s`);
      const wait = gap - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }
  }
  return results;
}

function median(values) {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const money = (value) => (value === null ? 'n/a' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`);

function report(results, date) {
  const lines = [];
  lines.push(`# Model test, ${date}`, '');
  lines.push(`${questions.length} questions × ${candidates.length} setups, run against ${url}. The backup model was off, so a failure shows as a failure.`, '');
  lines.push('**Expected** counts the citations a good answer should include (for the "should cite nothing" questions, 1 means it cited nothing). **Unsupported** counts citations that weren’t among the sections the Worker supplied: possible inventions. Cost is at each model’s paid price; on the Gemini free tier the real cost is $0, and the figure shows what the same use would cost with billing on.', '');
  lines.push('| Setup | Answered | Expected citations | Unsupported | Median time | Cost per question | At 10 questions/day |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const candidate of candidates) {
    const mine = results.filter((r) => r.candidate === candidate.id);
    const answered = mine.filter((r) => !r.error && r.answer).length;
    const hits = mine.reduce((sum, r) => sum + r.expected.hits, 0);
    const total = mine.reduce((sum, r) => sum + r.expected.total, 0);
    const unsupported = mine.reduce((sum, r) => sum + r.unsupported.length, 0);
    const costs = mine.map((r) => r.done?.cost).filter((c) => typeof c === 'number');
    const perQuestion = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    const monthly = perQuestion === null ? null : perQuestion * 300;
    const time = median(mine.map((r) => (r.error ? null : r.ms)));
    const free = candidate.freeTier ? ' (free tier: $0)' : '';
    lines.push(`| ${candidate.label} | ${answered}/${mine.length} | ${hits}/${total} | ${unsupported} | ${time === null ? 'n/a' : `${(time / 1000).toFixed(1)} s`} | ${money(perQuestion)}${free} | ${money(monthly)}${free} |`);
  }
  lines.push('');

  questions.forEach((question, i) => {
    lines.push(`## ${i + 1}. ${question.question}`, '');
    lines.push(question.expectNone
      ? '*Should cite nothing: it should decline, or say the documents are silent.*'
      : `Expected: ${question.expect.join(', ')}`);
    if (question.notes) lines.push('', `*${question.notes}*`);
    lines.push('');
    for (const candidate of candidates) {
      const r = results.find((x) => x.candidate === candidate.id && x.question === question.id);
      if (!r) continue;
      const summary = r.error
        ? `failed: ${r.error}`
        : `${r.expected.hits}/${r.expected.total} expected · ${r.unsupported.length} unsupported · ${(r.ms / 1000).toFixed(1)} s`;
      lines.push(`<details><summary><b>${candidate.label}</b>: ${summary}</summary>`, '');
      if (r.answer) lines.push(r.answer.trim().split('\n').map((line) => `> ${line}`).join('\n'), '');
      if (r.cited.length) lines.push(`Cited: ${r.cited.join(', ')}`, '');
      if (r.unsupported.length) lines.push(`Not among the supplied sections: ${r.unsupported.join(', ')}`, '');
      if (r.done?.plan) lines.push(`Planner proposed: ${r.done.plan.references.join(', ') || 'nothing'}; searched: ${r.done.plan.searches.join('; ') || 'nothing'}`, '');
      if (r.done?.failures?.length) lines.push(`Failures: ${r.done.failures.join(' | ')}`, '');
      lines.push('</details>', '');
    }
  });
  return lines.join('\n');
}

// --from a.json,b.json: re-score saved runs with the current rules and write one
// combined report, without asking anything again.
let results;
const from = option('from', '');
if (from) {
  const runs = from.split(',').map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const byId = new Map(questions.map((q) => [q.id, q]));
  candidates.length = 0;
  for (const run of runs) {
    for (const candidate of run.candidates) {
      if (!candidates.some((c) => c.id === candidate.id)) candidates.push(candidate);
    }
  }
  results = runs.flatMap((run) => run.results).map((r) => {
    const { cited, unsupported } = citations(r.answer, r.sources);
    return { ...r, cited, unsupported, expected: expectationHits(byId.get(r.question), cited) };
  });
} else {
  const lanes = [...new Set(candidates.map((c) => c.lane))];
  console.log(`Running ${questions.length} questions × ${candidates.length} setups in ${lanes.length} lanes (${lanes.join(', ')}).`);
  results = (await Promise.all(lanes.map(runLane))).flat();
}

const date = new Date().toISOString().slice(0, 10);
const dir = new URL('../comparison/', import.meta.url);
mkdirSync(dir, { recursive: true });
const stamp = `${date}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
writeFileSync(new URL(`${stamp}.json`, dir), JSON.stringify({ url, date, questions, candidates, results }, null, 2));
writeFileSync(new URL(`${stamp}.md`, dir), report(results, date));
console.log(`\nReport: assistant/comparison/${stamp}.md`);
