// The site's section index (assets/search_plus_index.json) as something the
// assistant can look citations up in and search. This file must stay
// dependency-free and use only erasable TypeScript, because test/corpus.test.ts
// runs it directly under Node.

export interface RawEntry {
  title: string;
  document: string;
  collection: string;
  order: number;
  reference: string;
  label: string;
  keywords: string;
  url: string;
  body: string;
  proofs: string;
}

export interface Section {
  /** Canonical lowercase citation, e.g. "wcf 17.1", "dort 3/4.2", "apostles creed". */
  key: string;
  /** What the model cites and the reader sees: "WCF 17.1", "Apostles’ Creed". */
  label: string;
  title: string;
  document: string;
  url: string;
  body: string;
  proofs: string;
  /** Lowercased, quote-normalized label + body, for search. */
  text: string;
  words: number;
}

// Entries without a short citation (the creeds) are cited by name. The Nicene
// Creed has two forms on the site, told apart by year.
const CREED_LABELS: Record<string, string> = {
  '/pages/apostles-creed/': 'Apostles’ Creed',
  '/pages/athanasian-creed/': 'Athanasian Creed',
  '/pages/nicene-creed/#nicene-381': 'Nicene Creed (381)',
  '/pages/nicene-creed/#nicene-325': 'Nicene Creed (325)',
};

// Leading words that name a document, in the forms readers and models use.
// Order matters: longer names before the abbreviations they contain.
const DOCUMENT_ALIASES: Array<[RegExp, string]> = [
  [/^(westminster confession of faith|westminster confession|confession of faith|wcf)\b/, 'wcf'],
  [/^(westminster shorter catechism|shorter catechism|wsc)\b/, 'wsc'],
  [/^(westminster larger catechism|larger catechism|wlc)\b/, 'wlc'],
  [/^(heidelberg catechism|heidelberg|hc)\b/, 'heidelberg'],
  [/^(belgic confession|belgic|bc)\b/, 'belgic'],
  [/^(canons of dort|canons of dordt|dort|dordt|cd)\b/, 'dort'],
  [/^(form of government|fg)\b/, 'fg'],
  [/^(book of discipline|bd)\b/, 'bd'],
  [/^(directory for the public worship of god|directory for public worship|directory of public worship|dpw)\b/, 'dpw'],
];

const CREED_ALIASES: Array<[RegExp, string]> = [
  [/^(the )?apostles'? creed$/, 'apostles creed'],
  [/^(the )?athanasian creed$/, 'athanasian creed'],
  [/^(the )?(niceno-constantinopolitan creed|nicene creed \(?381( ad)?\)?|nicene 381)$/, 'nicene creed 381'],
  [/^(the )?(nicene creed \(?325( ad)?\)?|nicene 325)$/, 'nicene creed 325'],
  [/^(the )?nicene creed$/, 'nicene creed'],
];

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };

function tidy(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The canonical key for a citation typed by a reader or proposed by a model, or
 * null when it doesn't name anything this site can hold. "WSC Q. 36" ->
 * "wsc 36"; "Westminster Confession 17:1" -> "wcf 17.1"; "Canons of Dort
 * III/IV, Article 2" -> "dort 3/4.2"; "Dort 1, Rejection 3" -> "dort 1 re 3".
 */
export function canonicalReference(input: string): string | null {
  let value = tidy(input).replace(/[.,;]+$/, '');
  if (!value) return null;

  for (const [pattern, key] of CREED_ALIASES) {
    if (pattern.test(value)) return key;
  }

  let documentKey: string | null = null;
  for (const [pattern, key] of DOCUMENT_ALIASES) {
    const match = pattern.exec(value);
    if (match) {
      documentKey = key;
      value = value.slice(match[0].length);
      break;
    }
  }
  if (!documentKey) return null;

  let rest = value
    .replace(/\b(question|questions|q&a|qq|q|answer|article|articles|art|chapter|ch|heads?|main points?|points?|section|sec|no|number)\b\.?/g, ' ')
    .replace(/\bq\.?\s*(?=\d)/g, ' ')
    .replace(/[#,()]/g, ' ')
    .replace(/(\d)\s*:\s*(\d)/g, '$1.$2');

  if (documentKey === 'dort') {
    rest = rest
      .replace(/\b(third and fourth|iii\s*[/&-]\s*iv|3\s*(?:[/&-]|and)\s*4)\b/, '3/4')
      .replace(/\b(first|second|fifth)\b/, (word) => ({ first: '1', second: '2', fifth: '5' })[word] ?? word)
      .replace(/^\s*(i{1,3}|iv|v)\b/, (numeral) => ROMAN[numeral.trim()] ?? numeral)
      .replace(/\b(rejections? of (the )?errors?|rejections?|rej|re)\b\.?/, ' re ');
    if (rest.trim() === 'conclusion') return 'dort conclusion';
  }

  // Whatever separates the parts ("17 1", "17.1", "2 B 3") becomes a dot, except
  // around Dort's rejections ("1 re 3") and the DPW preface ("preface 1").
  const tokens = rest.split(/[\s.]+/).filter(Boolean);
  if (tokens.length === 0) return documentKey;
  const re = tokens.indexOf('re');
  if (re !== -1) {
    rest = [tokens.slice(0, re).join('.'), 're', ...tokens.slice(re + 1)].join(' ');
  } else if (tokens[0] === 'preface') {
    rest = tokens.join(' ');
  } else {
    rest = tokens.join('.');
  }
  return `${documentKey} ${rest}`;
}

// Citations written into a question: "WLC 99", "WCF 17:1", "Heidelberg Q. 1",
// "Dort 3/4.2", "Dort 1 RE 3", "BD 2.B.3".
const CITATION_IN_TEXT =
  /\b(?:WCF|WSC|WLC|HC|Heidelberg|Belgic|Dort|FG|BD|DPW)\s*(?:Q\.?\s*)?(?:preface(?:\s+\d+)?|conclusion|\d+(?:\/\d+)?(?:[.:](?:\d+|[A-Za-z](?![A-Za-z])))*(?:\s+RE(?:\s+\d+)?)?)/gi;

/** Citations that appear in free text, as written. */
export function findReferences(text: string): string[] {
  return [...new Set((text.match(CITATION_IN_TEXT) ?? []).map((match) => match.trim()))];
}

const STOPWORDS = new Set((
  'a about above after again against all also am an and any are as at be because been before being ' +
  'below between both but by can could did do does doing down during each few for from further had has ' +
  'have having he her here hers him his how i if in into is it its itself just me more most my no nor ' +
  'not now of off on once only or other our ours out over own same she should so some such than that ' +
  'the their theirs them then there these they this those through to too under until up upon very was ' +
  'we were what when where which while who whom why will with would you your yours say says said tell ' +
  'teach teaches taught mean means meant according explain explained does did doth hath unto thee thou ' +
  'thy ye shall may might must'
).split(' '));

/** Search terms for a query: content words, cut to a prefix so "justification" meets "justifieth". */
export function queryTerms(query: string): string[] {
  const words = tidy(query).replace(/'s\b/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const terms: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word) || word.length < 3) continue;
    const term = word.length >= 8 ? word.slice(0, 6) : word.length >= 6 ? word.slice(0, 5) : word;
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

/** How many times `term` starts a word in `text`, capped. */
function countWordStarts(text: string, term: string, cap = 6): number {
  let count = 0;
  let from = 0;
  while (count < cap) {
    const at = text.indexOf(term, from);
    if (at === -1) break;
    const before = at === 0 ? ' ' : text[at - 1];
    if (!(before >= 'a' && before <= 'z') && !(before >= '0' && before <= '9')) count++;
    from = at + term.length;
  }
  return count;
}

export class Corpus {
  readonly sections: Section[];
  private readonly byKey = new Map<string, Section>();
  private readonly byDocumentKey = new Map<string, Section[]>();
  private readonly averageWords: number;

  constructor(index: Record<string, RawEntry>) {
    this.sections = [];
    for (const [url, entry] of Object.entries(index)) {
      const label = entry.reference || CREED_LABELS[url] || entry.document.replace(/^The /, '');
      const key = entry.reference ? tidy(entry.reference) : (canonicalReference(label) ?? tidy(label));
      const body = entry.body || '';
      const section: Section = {
        key,
        label,
        title: entry.title,
        document: entry.document,
        url: entry.url || url,
        body,
        proofs: entry.proofs || '',
        text: tidy(`${entry.label} ${body}`),
        words: body.split(/\s+/).length,
      };
      this.sections.push(section);
      this.byKey.set(section.key, section);
      if (section.key.startsWith('nicene creed')) {
        const both = this.byDocumentKey.get('nicene creed') ?? [];
        both.push(section);
        this.byDocumentKey.set('nicene creed', both);
      }
    }
    this.averageWords = this.sections.reduce((sum, s) => sum + s.words, 0) / Math.max(1, this.sections.length);
  }

  get size(): number {
    return this.sections.length;
  }

  /**
   * The sections a citation names. An exact unit returns itself; a unit with
   * subdivisions ("WCF 17", "Dort 1", "FG 3") returns its heading, if the site
   * has one, followed by its first `limit` subdivisions.
   */
  lookup(reference: string, limit = 8): Section[] {
    const key = canonicalReference(reference);
    if (!key) return [];
    const both = this.byDocumentKey.get(key);
    if (both) return both.slice();
    const exact = this.byKey.get(key);
    const children = this.sections.filter(
      (s) => s.key.startsWith(`${key}.`) || (s.key.startsWith(`${key} `) && !s.key.startsWith(`${key} re`)),
    );
    if (exact && children.length === 0) return [exact];
    const found = exact ? [exact, ...children] : children;
    return found.slice(0, limit + (exact ? 1 : 0));
  }

  /** Sections ranked for a free-text query (BM25 over word-start prefixes, plus a phrase bonus). */
  search(query: string, limit = 5): Section[] {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];
    const phrase = tidy(query).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const k1 = 1.2;
    const b = 0.75;
    const n = this.sections.length;

    const counts = terms.map((term) => this.sections.map((s) => countWordStarts(s.text, term)));
    const idf = counts.map((perSection) => {
      const df = perSection.filter((c) => c > 0).length;
      return Math.log(1 + (n - df + 0.5) / (df + 0.5));
    });

    const scored: Array<{ section: Section; score: number }> = [];
    this.sections.forEach((section, i) => {
      let score = 0;
      let matched = 0;
      terms.forEach((_, t) => {
        const tf = counts[t][i];
        if (tf === 0) return;
        matched++;
        score += idf[t] * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * section.words) / this.averageWords)));
      });
      if (score === 0) return;
      // Prefer sections that contain more of the query's words, and the exact phrase.
      score *= 0.5 + (0.5 * matched) / terms.length;
      if (phrase.split(' ').length >= 2 && section.text.includes(phrase)) score += 3;
      scored.push({ section, score });
    });

    scored.sort((a, b2) => b2.score - a.score);
    return scored.slice(0, limit).map((s) => s.section);
  }
}

let cached: { url: string; at: number; corpus: Promise<Corpus> } | null = null;
const MAX_AGE_MS = 60 * 60 * 1000;

/** The corpus for `url`, fetched once per Worker instance and refreshed hourly. */
export function loadCorpus(url: string): Promise<Corpus> {
  if (cached && cached.url === url && Date.now() - cached.at < MAX_AGE_MS) return cached.corpus;
  const corpus = fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit)
    .then((response) => {
      if (!response.ok) throw new Error(`Section index fetch failed: HTTP ${response.status}`);
      return response.json() as Promise<Record<string, RawEntry>>;
    })
    .then((index) => new Corpus(index));
  cached = { url, at: Date.now(), corpus };
  corpus.catch(() => {
    if (cached?.corpus === corpus) cached = null;
  });
  return corpus;
}
