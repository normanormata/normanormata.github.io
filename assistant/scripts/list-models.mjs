#!/usr/bin/env node
// Lists the model IDs your keys can use, to check the IDs in wrangler.jsonc and
// scripts/compare-models.mjs before a test run. Reads the keys from .dev.vars.
//
//   npm run models

import { readFileSync } from 'node:fs';

function devVars() {
  let text = '';
  try {
    text = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  } catch {
    console.error('No .dev.vars yet: copy .dev.vars.example to .dev.vars and add your keys.');
    process.exit(1);
  }
  const vars = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || line.startsWith('#') || eq === -1) continue;
    vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return vars;
}

const vars = devVars();

if (vars.GEMINI_API_KEY) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': vars.GEMINI_API_KEY },
  });
  const body = await response.json();
  if (!response.ok) {
    console.log(`Gemini: HTTP ${response.status} ${body.error?.message ?? ''}`);
  } else {
    const ids = (body.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => /flash|pro/.test(id));
    console.log('Gemini (use as google/<id>):');
    for (const id of ids) console.log(`  ${id}`);
  }
} else {
  console.log('Gemini: no GEMINI_API_KEY in .dev.vars');
}

if (vars.FIREWORKS_API_KEY) {
  const response = await fetch('https://api.fireworks.ai/inference/v1/models', {
    headers: { Authorization: `Bearer ${vars.FIREWORKS_API_KEY}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.log(`Fireworks: HTTP ${response.status} ${body.error?.message ?? body.message ?? ''}`);
  } else {
    console.log('\nFireworks (use as fireworks/<id>):');
    for (const model of body.data ?? []) console.log(`  ${model.id}`);
  }
} else {
  console.log('Fireworks: no FIREWORKS_API_KEY in .dev.vars');
}
