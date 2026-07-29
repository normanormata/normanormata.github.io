#!/usr/bin/env python3
"""Reformat Heidelberg Catechism proofs into the site's Scripture Proofs callouts.

Today each answer carries bracketed markers [1], [2], … and a trailing line of
citations "[1] I Cor. 6:19, 20 [2] Rom. 14:7-9. …". This converts them to the
same collapsible, RefTagger-linked format the Westminster Standards use:

  * every inline [n] becomes a linked superscript marker;
  * the trailing citation line becomes a <details class="scripture-proofs">
    callout, numbers rendered as <strong>1.</strong> like the lettered ones.

The references themselves are copied verbatim — this is a reformatting, not a
re-sourcing. Questions with no bracketed footnotes (the creed recitation and
the sacrament-institution answers) are left exactly as they are.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path("/Users/tteschon/Documents/code/normanormata.github.io")
PATH = ROOT / "_pages" / "heidelberg.md"

# Headers are "## 1. Question:" — but Q88 is "## 88 Question" with no period, so
# the period is optional.
QHEAD = re.compile(r"^## (\d+)\.? Question", re.M)
# A citation paragraph is a line that begins with a bracketed number.
CITE_LINE = re.compile(r"^\[\d+\].*$", re.M)
INLINE = re.compile(r"\[(\d+)\]")


def split_citations(line):
    """'[1] a; b [2] c' -> [('1', 'a; b'), ('2', 'c')], order preserved."""
    parts = re.split(r"\[(\d+)\]", line)
    # parts = ['', '1', ' a; b ', '2', ' c']
    out = []
    for i in range(1, len(parts), 2):
        num = parts[i]
        text = parts[i + 1].strip().rstrip(".").strip() if i + 1 < len(parts) else ""
        out.append((num, text))
    return out


def convert(text):
    out = []
    pos = 0
    stats = {"converted": 0, "skipped": 0, "markers": 0,
             "citation_only": 0, "orphans": []}

    heads = list(QHEAD.finditer(text))
    out.append(text[:heads[0].start()] if heads else text)

    for i, h in enumerate(heads):
        qnum = h.group(1)
        start = h.start()
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        block = text[start:end]

        cites = CITE_LINE.findall(block)
        if not cites:
            out.append(block)
            stats["skipped"] += 1
            continue

        # There should be exactly one citation paragraph; join if a stray wrap.
        cite_line = " ".join(cites)
        proofs = split_citations(cite_line)
        proof_nums = [n for n, _ in proofs]

        # Body = block with the citation paragraph(s) removed.
        body = CITE_LINE.sub("", block).rstrip()

        inline_nums = INLINE.findall(body)
        stats["markers"] += len(inline_nums)
        for n in inline_nums:
            if n not in proof_nums:
                stats["orphans"].append((qnum, n))
        stats["citation_only"] += sum(1 for n in proof_nums if n not in inline_nums)

        def marker(m):
            n = m.group(1)
            return (f'<sup class="proof-marker">'
                    f'<a href="#hc-q{qnum}-proofs" '
                    f'aria-label="Scripture proof {n}, question {qnum}">{n}</a>'
                    f"</sup>")

        body = INLINE.sub(marker, body)

        refs_html = ", ".join(
            f"<strong>{n}.</strong> {t}" for n, t in proofs if t)
        callout = (
            f'<details class="scripture-proofs" id="hc-q{qnum}-proofs">\n'
            f"<summary>Scripture Proofs</summary>\n"
            f'<div class="proofs-body">\n'
            f"<p>{refs_html}</p>\n"
            f"</div>\n"
            f"</details>")

        out.append(body.rstrip() + "\n\n" + callout + "\n")
        stats["converted"] += 1

    return "".join(out), stats


def main():
    write = "--write" in sys.argv
    text = PATH.read_text(encoding="utf-8")
    new, stats = convert(text)
    print(f"converted {stats['converted']} questions, "
          f"skipped {stats['skipped']} (no bracketed proofs)")
    print(f"inline markers linked: {stats['markers']}")
    print(f"citation numbers with no inline marker: {stats['citation_only']}")
    if stats["orphans"]:
        print(f"INLINE MARKERS WITH NO CITATION (would 404): {len(stats['orphans'])}")
        for q, n in stats["orphans"][:20]:
            print(f"   Q{q} [{n}]")
    if write:
        PATH.write_text(new, encoding="utf-8")
        print("written")
    else:
        print("\n(dry run — pass --write)")


if __name__ == "__main__":
    main()
