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
- **Section-level search** — results deep-link to the individual chapter, section, or
  catechism question rather than the top of a 2,000-line page.
- **Scripture reference tooltips** via [RefTagger](https://faithlife.com/products/reftagger).

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
| `assets/gitbook/custom.js` | Toolbar buttons, version toggle, RefTagger re-tagging |
| `assets/search_plus_index.json` | Liquid template that builds the section-level search index |

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
- In the Westminster Standards, wording that differs between versions is marked up as
  adjacent `<span class="v-const">` / `<span class="v-modern">` pairs. Both must be
  present, in that order, and neither may nest or contain markup — `script/check-variant-markup.py`
  enforces this, and the search index depends on it.

## Checks

Both run in CI (`.github/workflows/build.yml`) and can be run by hand:

```bash
python3 script/check-variant-markup.py
```

Validates the version-toggle markup: no nested or non-plain-text variant spans, no
`class="…"` attributes corrupted by a find/replace, no answer that opens with a word
which disappears in MESV mode.

```bash
python3 script/check-links.py _site
```

Checks every internal link and `#fragment` in the built site, including the ~1,800
proof-marker anchors and all 826 search-index deep links. Run a build first.

## External dependencies

The site loads [RefTagger](https://faithlife.com/products/reftagger) from
`api.reftagger.com` to turn scripture references into tooltips. If that service goes
away, references degrade to plain text — nothing else breaks.

## License

See [LICENSE](LICENSE). The confessional texts themselves are in the public domain.
