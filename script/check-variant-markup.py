#!/usr/bin/env python3
"""Check the version-toggle markup in the Westminster Standards.

assets/search_plus_index.json strips the modern variants out of the search index
with plain Liquid string splitting, which is only correct while the marked-up
spans hold plain text and never nest. This enforces that, plus two failure modes
that reached production before:

  * `class="…"` corrupted into `cl<span class="v-const">as</span>s="…"` by a
    find/replace of the word "as" that matched inside the attribute name;
  * a v-const span with no v-modern sibling at the start of an answer, so the
    word simply vanished when the reader switched to the MESV.

Run with no arguments from the repository root. Exits non-zero on any finding.
"""
import pathlib
import re
import sys

FILES = ["wcf", "wsc", "wlc"]
OPEN_VARIANT = re.compile(r'<span class="(v-const|v-modern)">')
ANY_SPAN = re.compile(r"<span[^>]*>|</span>")
CORRUPT = re.compile(r'cl<span class="v-(const|modern)">as</span>')
ANSWER_ORPHAN = re.compile(r'Answer: <span class="v-const">([^<]*)</span>(?!<span class="v-modern">)')


def top_level_variants(text):
    """Yield (offset, kind, inner) for each outermost variant span."""
    i = 0
    while True:
        m = OPEN_VARIANT.search(text, i)
        if not m:
            return
        depth, j = 1, m.end()
        while depth:
            nxt = ANY_SPAN.search(text, j)
            if not nxt:
                raise ValueError(f"unbalanced <span> at offset {m.start()}")
            depth += 1 if nxt.group(0).startswith("<span") else -1
            j = nxt.end()
        yield m.start(), m.group(1), text[m.end():j - len("</span>")]
        i = j


def line_of(text, offset):
    return text.count("\n", 0, offset) + 1


def check(path):
    text = path.read_text(encoding="utf-8")
    name = path.name
    problems = []

    closes = text.count("</span>")
    opens = len(ANY_SPAN.findall(text)) - closes
    if opens != closes:
        problems.append(f"{name}: unbalanced span tags "
                        f"({opens} open vs {closes} close)")

    for m in CORRUPT.finditer(text):
        problems.append(
            f"{name}:{line_of(text, m.start())}: corrupted attribute — "
            f'a find/replace wrapped the "as" inside class="…". '
            f"Expected class=\"…\", found {text[m.start():m.start() + 60]!r}")

    try:
        for offset, kind, inner in top_level_variants(text):
            if OPEN_VARIANT.search(inner):
                problems.append(
                    f"{name}:{line_of(text, offset)}: nested variant span inside "
                    f"<{kind}> — flatten it, the search index strip cannot handle "
                    f"nesting ({inner[:50]!r})")
            elif "<" in inner:
                problems.append(
                    f"{name}:{line_of(text, offset)}: markup inside <{kind}> — the "
                    f"search index strip expects plain text ({inner[:50]!r})")
    except ValueError as exc:
        problems.append(f"{name}: {exc}")

    for m in ANSWER_ORPHAN.finditer(text):
        problems.append(
            f"{name}:{line_of(text, m.start())}: answer opens with a v-const span "
            f"({m.group(1)!r}) that has no v-modern counterpart, so the word "
            f"disappears in MESV mode")

    return problems


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    problems = []
    for stem in FILES:
        path = root / "_pages" / f"{stem}.md"
        if not path.exists():
            problems.append(f"missing {path}")
            continue
        problems += check(path)

    if problems:
        print(f"variant markup check FAILED ({len(problems)} problems)\n")
        for p in problems:
            print("  " + p)
        return 1

    print(f"variant markup OK ({', '.join(f'{s}.md' for s in FILES)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
