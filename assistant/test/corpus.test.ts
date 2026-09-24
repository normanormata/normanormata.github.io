// Checks the assistant's view of the site's section index. Runs under Node's
// built-in test runner against the built site, so build first:
//   bundle exec jekyll build && (cd assistant && npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Corpus, canonicalReference, findReferences, type RawEntry } from '../src/corpus.ts';

const indexPath = fileURLToPath(new URL('../../_site/assets/search_plus_index.json', import.meta.url));
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, RawEntry>;
const corpus = new Corpus(index);

test('every indexed section is reachable by its own citation', () => {
  assert.equal(corpus.size, Object.keys(index).length);
  for (const [url, entry] of Object.entries(index)) {
    const citation = entry.reference || corpus.sections.find((s) => s.url === (entry.url || url))!.label;
    const found = corpus.lookup(citation);
    assert.ok(
      found.some((s) => s.url === (entry.url || url)),
      `${citation} did not look up ${url}`,
    );
  }
});

test('citations are normalized the way readers and models write them', () => {
  const cases: Array<[string, string | null]> = [
    ['WCF 17.1', 'wcf 17.1'],
    ['Westminster Confession 17:1', 'wcf 17.1'],
    ['Westminster Confession of Faith, chapter 17, section 1', 'wcf 17.1'],
    ['WSC Q. 36', 'wsc 36'],
    ['Shorter Catechism Question 1', 'wsc 1'],
    ['WLC Q79', 'wlc 79'],
    ['Heidelberg Q&A 1', 'heidelberg 1'],
    ['HC 21', 'heidelberg 21'],
    ['Belgic Confession, Article 24', 'belgic 24'],
    ['Canons of Dort III/IV, Article 2', 'dort 3/4.2'],
    ['Dort 3/4.2', 'dort 3/4.2'],
    ['Dort 1, Rejection 3', 'dort 1 re 3'],
    ['Dort 1 RE', 'dort 1 re'],
    ['Dort V 8', 'dort 5.8'],
    ['Dort Conclusion', 'dort conclusion'],
    ['FG 3.3', 'fg 3.3'],
    ['BD 2.B.3', 'bd 2.b.3'],
    ['DPW Preface 1', 'dpw preface 1'],
    ['DPW 1.A.1', 'dpw 1.a.1'],
    ['The Apostles’ Creed', 'apostles creed'],
    ['Nicene Creed (381)', 'nicene creed 381'],
    ['Nicene Creed', 'nicene creed'],
    ['Romans 8:28', null],
    ['', null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(canonicalReference(input), expected, input);
  }
});

test('a unit with subdivisions returns its parts', () => {
  const chapter = corpus.lookup('WCF 17').map((s) => s.label);
  assert.deepEqual(chapter, ['WCF 17.1', 'WCF 17.2', 'WCF 17.3']);
  const head = corpus.lookup('Dort 5', 3).map((s) => s.label);
  assert.deepEqual(head, ['Dort 5', 'Dort 5.1', 'Dort 5.2', 'Dort 5.3']);
  assert.equal(corpus.lookup('Nicene Creed').length, 2);
  assert.deepEqual(corpus.lookup('WSC 1').map((s) => s.label), ['WSC 1']);
  assert.deepEqual(corpus.lookup('WCF 99.9'), []);
});

test('keyword search finds the expected sections', () => {
  const top = (query: string, n = 5) => corpus.search(query, n).map((s) => s.label);
  assert.ok(top('chief end of man glorify God enjoy him').includes('WSC 1'), 'WSC 1');
  assert.ok(top('only comfort in life and death').includes('Heidelberg 1'), 'Heidelberg 1');
  assert.ok(top('persevere state of grace fall away', 8).some((l) => l.startsWith('WCF 17.')), 'WCF 17');
  assert.ok(top('justification', 10).some((l) => l === 'WSC 33' || l.startsWith('WCF 11.')), 'justification');
  assert.ok(top('descended into hell', 8).some((l) => l === 'Apostles’ Creed' || l === 'WLC 50' || l === 'Heidelberg 44'), 'hell');
  assert.deepEqual(corpus.search('the of and'), []);
});

test('citations written into a question are found and resolve', () => {
  const found = findReferences('What do WLC 99, WCF 17:1, Heidelberg Q. 1, Dort 3/4.2, Dort 1 RE 3 and BD 2.B.3 say?');
  assert.deepEqual(found, ['WLC 99', 'WCF 17:1', 'Heidelberg Q. 1', 'Dort 3/4.2', 'Dort 1 RE 3', 'BD 2.B.3']);
  for (const reference of found) assert.equal(corpus.lookup(reference).length > 0, true, reference);
  assert.deepEqual(findReferences('Can a Christian lose their salvation?'), []);
  assert.deepEqual(findReferences('It is in WCF 17. The chapter goes on.'), ['WCF 17']);
});
