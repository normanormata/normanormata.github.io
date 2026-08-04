#!/usr/bin/env python3
"""Generate the scripture index from the confessions' proof callouts.

The site answers "what does WCF 11.1 cite?" already. This builds the reverse:
one page per book of the Bible listing, chapter by chapter, every place in the
Westminster Standards and the Heidelberg Catechism that cites it.

The pages are generated rather than hand-written so they cannot drift from the
proofs. CI runs --check, which fails if the committed pages no longer match what
the current proof callouts produce.

Usage:
  python3 script/build-scripture-index.py           # write _scripture/
  python3 script/build-scripture-index.py --check   # verify, write nothing
"""
import collections
import sys

import scripture_refs as refs

OUT = refs.REPO / "_scripture"

# Reference ordering within a passage: document order first, then the number.
DOC_ORDER = {d["prefix"]: i for i, d in enumerate(refs.DOCUMENTS)}


def book_slug(name):
    return name.lower().replace(" ", "-")


def chapter_anchor(book, chapter):
    """The heading id for a chapter. Books with no chapters get the bare slug."""
    if book in refs.SINGLE_CHAPTER:
        return book_slug(book)
    return "%s-%d" % (book_slug(book), chapter)


def reference_sort_key(reference):
    document, _, number = reference.rpartition(" ")
    parts = [int(p) for p in number.split(".")]
    return (DOC_ORDER.get(document, 99), parts + [0])


def escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def front_matter(fields):
    lines = ["---"]
    for key, value in fields.items():
        if isinstance(value, bool):
            lines.append("%s: %s" % (key, "true" if value else "false"))
        elif isinstance(value, str):
            lines.append('%s: "%s"' % (key, value.replace('"', '\\"')))
        else:
            lines.append("%s: %s" % (key, value))
    lines.append("---")
    return "\n".join(lines)


def group(citations):
    """citations -> {book: {chapter: [(sort_key, label, [references])]}}"""
    by_book = collections.defaultdict(lambda: collections.defaultdict(dict))
    for citation in citations:
        chapter = by_book[citation["book"]][citation["chapter"]]
        entry = chapter.setdefault(citation["label"], {
            "sort": (citation["start"], citation["end"] or citation["start"]),
            "refs": {},
        })
        entry["refs"][citation["reference"]] = citation["url"]

    shaped = {}
    for book, chapters in by_book.items():
        shaped[book] = {}
        for chapter, passages in chapters.items():
            rows = sorted(
                ((data["sort"], label, data["refs"]) for label, data in passages.items()),
                key=lambda row: (row[0], row[1]),
            )
            shaped[book][chapter] = rows
    return shaped


def render_passages(rows, drop_chapter=False):
    out = ['<ul class="scripture-index">']
    for _sort, label, references in rows:
        # Jude 6 is a verse, not a chapter, so its label reads "6" not "1:6".
        if drop_chapter:
            label = label.replace("1:", "", 1)
        cites = "".join(
            '<a href="{{ site.baseurl }}%s">%s</a>' % (references[reference], escape(reference))
            for reference in sorted(references, key=reference_sort_key)
        )
        out.append(
            '<li><span class="scripture-index__passage">%s</span>'
            '<span class="scripture-index__cites">%s</span></li>' % (escape(label), cites)
        )
    out.append("</ul>")
    return "\n".join(out)


def render_book(book, chapters, previous, following):
    slug = book_slug(book)
    numbered = sorted(chapters)
    whole_book = book in refs.SINGLE_CHAPTER
    passages = sum(len(rows) for rows in chapters.values())
    links = sum(len(row[2]) for rows in chapters.values() for row in rows)

    description = (
        "Every place the Westminster Standards and the Heidelberg Catechism cite %s "
        "in their scripture proofs — %d reference%s to %d passage%s."
        % (book, links, "" if links == 1 else "s",
           passages, "" if passages == 1 else "s")
    )

    parts = [front_matter({
        "title": book,
        "layout": "scripture",
        "description": description,
        # These pages are a navigational index, not source text. Indexing every
        # chapter heading would bury the confessions themselves in the site
        # search, which is what a reader is actually looking for.
        "exclude_from_search": True,
    })]
    parts.append("")
    parts.append(
        "%d reference%s to %d passage%s of %s, drawn from the scripture proofs of the "
        "[Westminster Standards]({{ site.baseurl }}/pages/wcf/) and the "
        "[Heidelberg Catechism]({{ site.baseurl }}/pages/heidelberg/). "
        "Every reference links to the section that cites the passage."
        % (links, "" if links == 1 else "s",
           passages, "" if passages == 1 else "s", book)
    )

    if len(numbered) > 1:
        # Raw anchors, not markdown links: kramdown does not process markdown
        # inside a block-level HTML element, so [1](#psalms-1) would print as-is.
        jump = "\n".join(
            '<a href="#%s-%d">%d</a>' % (slug, chapter, chapter) for chapter in numbered
        )
        parts.append("")
        parts.append('<p class="scripture-chapters">%s</p>' % jump)

    for chapter in numbered:
        parts.append("")
        parts.append("## %s" % (book if whole_book else "%s %d" % (book, chapter)))
        parts.append("")
        parts.append(render_passages(chapters[chapter], whole_book))

    parts.append("")
    parts.append('<nav class="scripture-nav" aria-label="Scripture index navigation">')
    if previous:
        parts.append('<a href="{{ site.baseurl }}/scripture/%s/">← %s</a>'
                     % (book_slug(previous), escape(previous)))
    parts.append('<a href="{{ site.baseurl }}/scripture/">All books</a>')
    if following:
        parts.append('<a href="{{ site.baseurl }}/scripture/%s/">%s →</a>'
                     % (book_slug(following), escape(following)))
    parts.append("</nav>")
    parts.append("")
    return "\n".join(parts)


def render_overview(shaped):
    totals = {book: sum(len(rows) for rows in chapters.values())
              for book, chapters in shaped.items()}
    cited = [name for name, _, _ in refs.BOOKS if name in shaped]
    uncited = [name for name, _, _ in refs.BOOKS if name not in shaped]
    passages = sum(totals.values())
    links = sum(len(row[2])
                for chapters in shaped.values()
                for rows in chapters.values()
                for row in rows)

    parts = [front_matter({
        "title": "Scripture Index",
        "layout": "scripture",
        "permalink": "/scripture/",
        "description": ("Find every place the Westminster Standards and the Heidelberg "
                        "Catechism cite a passage of scripture — %d passages across %d "
                        "books of the Bible." % (passages, len(cited))),
        "exclude_from_search": True,
    })]
    parts.append("")
    parts.append(
        "The confessions cite scripture; this is the other direction. "
        "The scripture proofs of the "
        "[Westminster Confession]({{ site.baseurl }}/pages/wcf/), the "
        "[Shorter]({{ site.baseurl }}/pages/wsc/) and "
        "[Larger]({{ site.baseurl }}/pages/wlc/) Catechisms, and the "
        "[Heidelberg Catechism]({{ site.baseurl }}/pages/heidelberg/) make "
        "**%s references** to **%s distinct passages** in **%d books** of the Bible. "
        "Pick a book to see which sections cite it."
        % ("{:,}".format(links), "{:,}".format(passages), len(cited))
    )

    for testament, heading in (("OT", "The Old Testament"), ("NT", "The New Testament")):
        books = [b for b in cited if refs.TESTAMENT[b] == testament]
        parts.append("")
        parts.append("## %s" % heading)
        parts.append("")
        parts.append('<ul class="scripture-books">')
        for book in books:
            parts.append(
                '<li><a href="{{ site.baseurl }}/scripture/%s/">%s</a>'
                '<span class="scripture-books__count">%d</span></li>'
                % (book_slug(book), escape(book), totals[book])
            )
        parts.append("</ul>")

    # Most-cited passages: a genuinely interesting view of what the confessions
    # lean on, and it costs nothing to derive.
    ranked = sorted(
        ((len(rows_refs), book, chapter, label)
         for book, chapters in shaped.items()
         for chapter, rows in chapters.items()
         for _sort, label, rows_refs in rows),
        key=lambda row: (-row[0], row[1], row[2], row[3]),
    )[:15]
    parts.append("")
    parts.append("## Most-cited passages")
    parts.append("")
    parts.append('<ul class="scripture-index">')
    for count, book, chapter, label in ranked:
        if book in refs.SINGLE_CHAPTER:
            shown = "%s %s" % (book, label.replace("1:", "", 1))
        else:
            shown = "%s %s" % (book, label)
        parts.append(
            '<li><span class="scripture-index__passage">'
            '<a href="{{ site.baseurl }}/scripture/%s/#%s">%s</a></span>'
            '<span class="scripture-index__cites">%d sections</span></li>'
            % (book_slug(book), chapter_anchor(book, chapter), escape(shown), count)
        )
    parts.append("</ul>")

    if uncited:
        parts.append("")
        parts.append("%s %s cited in these proofs."
                     % (", ".join(uncited),
                        "is not" if len(uncited) == 1 else "are not"))
    parts.append("")
    return "\n".join(parts)


def build():
    citations, unparsed = refs.collect()
    if unparsed:
        raise SystemExit(
            "unparsed proof citations:\n  " + "\n  ".join(unparsed[:20]))

    shaped = group(citations)
    cited = [name for name, _, _ in refs.BOOKS if name in shaped]

    pages = {"index.md": render_overview(shaped)}
    for position, book in enumerate(cited):
        pages[book_slug(book) + ".md"] = render_book(
            book,
            shaped[book],
            cited[position - 1] if position else None,
            cited[position + 1] if position + 1 < len(cited) else None,
        )
    return pages, citations, shaped


def main(argv):
    check = "--check" in argv
    pages, citations, shaped = build()

    if check:
        existing = {p.name: p.read_text(encoding="utf-8")
                    for p in OUT.glob("*.md")} if OUT.exists() else {}
        problems = []
        for name in sorted(set(existing) | set(pages)):
            if name not in existing:
                problems.append("missing: _scripture/%s" % name)
            elif name not in pages:
                problems.append("stale: _scripture/%s" % name)
            elif existing[name] != pages[name]:
                problems.append("out of date: _scripture/%s" % name)
        if problems:
            print("\n".join(problems), file=sys.stderr)
            print("\nRun: python3 script/build-scripture-index.py", file=sys.stderr)
            return 1
        print("scripture index matches the proofs (%d pages, %d citations)"
              % (len(pages), len(citations)))
        return 0

    OUT.mkdir(exist_ok=True)
    for stale in OUT.glob("*.md"):
        if stale.name not in pages:
            stale.unlink()
    for name, text in pages.items():
        (OUT / name).write_text(text, encoding="utf-8")

    passages = sum(len(rows) for chapters in shaped.values() for rows in chapters.values())
    print("wrote %d pages: %d citations, %d passages, %d books"
          % (len(pages), len(citations), passages, len(shaped)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
