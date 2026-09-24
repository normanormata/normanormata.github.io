# Creeds & Confessions

Source for **[creedsandconfessions.com](https://creedsandconfessions.com)** — a searchable
edition of the creeds, confessions, and catechisms of the church.

| | |
|---|---|
| Ecumenical creeds | Apostles', Nicene, Athanasian |
| Westminster Standards | Confession of Faith, Shorter Catechism, Larger Catechism |
| Three Forms of Unity | Belgic Confession, Heidelberg Catechism, Canons of Dort |
| OPC Book of Church Order | Form of Government, Book of Discipline, Directory for Public Worship |

## Features

- **Version toggle** on the Westminster Standards — read the constitutional text or the
  2025 Modern English Study Version, with an option to highlight what changed. The MESV
  is for study only and carries no constitutional authority.
- **Scripture proofs** in collapsible callouts, using the OPC lettered proof scheme.
- **Section-level search** at `/search/` — filter by collection or document, use
  reference shortcuts such as `WCF 3.1`, and deep-link to the individual chapter,
  section, or catechism question. Scripture proof text appears in an excerpt only
  when the proof itself matches.
- **Edition provenance** on every document — organization, edition, authoritative
  source, verification date, and independent-site notice.
- **Scripture reference tooltips** via [RefTagger](https://faithlife.com/products/reftagger).
- **Ask** at `/ask/`: questions in plain words, answered by an AI model from this site's
  own text only, with every cited section linked. It runs as a separate Cloudflare Worker
  (`assistant/`), and stays hidden until `assistant_url` is set in `_config.yml`. See
  [assistant/README.md](assistant/README.md).

## Building locally

Requires Ruby 2.7 or newer (the `github-pages` gem does not support 2.6).

```bash
bundle install
bundle exec jekyll serve
```

The site is then at <http://localhost:4000>.

To match what GitHub Pages actually builds, keep `Gemfile.lock` committed and run
`bundle update github-pages` rather than upgrading Jekyll directly.

## Layout

| Path | Purpose |
|---|---|
| `index.md` | Homepage |
| `_pages/*.md` | The twelve documents |
| `_layouts/`, `_includes/` | Local overrides of the `jekyll-gitbook` remote theme |
| `assets/gitbook/custom-local.css` | All site-specific CSS (callouts, version toggle, print) |
| `assets/gitbook/custom.js` | Accessible reader controls, version toggle, mobile section selector, RefTagger re-tagging |
| `assets/search_plus_index.json` | Liquid template that builds the section-level search index (also the Ask assistant's only source) |
| `ask.md`, `assets/gitbook/ask.js` | The Ask page |
| `assistant/` | The Ask assistant's Worker, tests and model test; excluded from the Jekyll build |
| `test/fixtures/westminster-text.json` | Constitutional and 2025 MESV passages extracted from the OPC comparison PDFs |

### Notes for editors

- **GitHub Pages builds this site with Jekyll 3.10, not Jekyll 4.** Several things work
  locally on Jekyll 4 and do nothing in production — most notably an `order:` list under
  a collection, which Jekyll 4 honours and 3.10 ignores silently. Verify against the
  `github-pages` gem, not a newer Jekyll.
- Sidebar order comes from `nav_order` in each page's front matter, sorted explicitly in
  `_includes/toc-date.html` and `_layouts/post.html` (which also derives the prev/next
  arrows from it — `page.previous`/`page.next` follow Jekyll's own collection order and
  are wrong here). Group headings are emitted whenever `category` changes, so keep
  same-category pages contiguous in the `nav_order` sequence.
- The theme is pinned by SHA in `_config.yml`. Bump it deliberately; upstream has no tags.
- In the Westminster Standards, the constitutional wording is the ordinary,
  crawler-visible text. Each difference uses one
  `<span class="text-variant" data-modern="…">constitutional wording</span>`.
  JavaScript reads `data-modern` only after the visitor explicitly selects MESV;
  search engines and no-JavaScript readers therefore receive one edition, never
  concatenated alternatives.
- Do not hand-edit Westminster variant spans. Update the authoritative PDFs if
  needed, run `script/build-westminster-fixtures.py`, then run
  `script/rebuild-westminster-variants.py`.

## Checks

These run in CI (`.github/workflows/build.yml`) and can be run by hand:

```bash
python3 script/build-westminster-fixtures.py --check
python3 script/check-variant-markup.py
```

Re-extracts the comparison PDFs to prove the committed fixture is current, then
reconstructs and compares all 474 constitutional and MESV passages against it.
The check also rejects legacy paired spans and known merged-word corruption.

```bash
python3 script/section-anchors.py --check
```

Verifies the short section anchors outside the Westminster Standards — `#hc-q1`,
`#belgic-1`, `#dort-3-4-2`, `#fg-3-3`, `#bd-2-b-3`, `#dpw-1-a-1`, `#nicene-381` — are
present, unique, and numbered in sequence. Run it without `--check` to regenerate
them after adding or renumbering a heading or church-order paragraph.

```bash
python3 script/check-generated-html.py _site
```

Checks one visible H1, one main landmark, one skip link, named buttons, edition
panels, crawler-visible variant integrity, and labeled reader controls. Run a
build first.

```bash
python3 script/check-links.py _site
```

Checks every internal link and `#fragment` in the built site, including the ~1,800
proof-marker anchors and all 826 search-index deep links. Run a build first.

## External dependencies

The site loads [RefTagger](https://faithlife.com/products/reftagger) from
`api.reftagger.com` to turn scripture references into tooltips. If that service goes
away, references degrade to plain text — nothing else breaks.

With `assistant_url` set, the Ask page, the toolbar's Ask button, and the search page's
"Ask this as a question" link call the assistant Worker, which calls an AI provider. The
page names the provider and says how it treats questions. If the Worker or the provider is
unavailable, a backup model answers; if both are down, the Ask page says so and points to
search. Nothing else on the site depends on it.

## License

See [LICENSE](LICENSE). The confessional texts themselves are in the public domain.
