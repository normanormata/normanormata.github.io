#!/usr/bin/env python3
"""Give every citable unit outside the Westminster Standards a short anchor.

The Westminster Standards have always carried one: <span id="wcf-1-4"> leads
each section of the Confession and <span id="wsc-q1"> precedes each catechism
question, so /pages/wcf/#wcf-1-4 can be shared. Everything else could only be
linked by kramdown's auto-generated heading slugs
(#1-question-what-is-your-only-comfort-in-life-and-death), and the Book of
Church Order's numbered paragraphs not at all.

This writes the same kind of empty <span id> for:

  Heidelberg Catechism   question                          hc-q1
  Belgic Confession      article                           belgic-1
  Canons of Dort         head, article                     dort-1, dort-3-4-2
                         rejection of errors, error        dort-1-rej, dort-1-rej-1
                         conclusion                        dort-conclusion
  Form of Government     chapter, section, paragraph       fg-3, fg-29-a, fg-3-3
  Book of Discipline     chapter, section, paragraph       bd-2, bd-2-b, bd-2-b-3
  Directory for Worship  preface/chapter, section, para.   dpw-preface-1, dpw-1-a-1
  Nicene Creed           the two forms                     nicene-381, nicene-325

A heading's span goes on its own line just before the heading, as in the
Shorter and Larger Catechisms. The heading line itself is untouched, so its
kramdown id — and every link already made to it — keeps working.

A church-order paragraph's span leads the paragraph, as in the Confession. That
also fixes its number: "3. The names of members…" used to be a Markdown ordered
list, and kramdown restarts every list interrupted by an unnumbered paragraph
at 1, so Book of Discipline 2.B.3 was displayed as "1.". With the span in front
the line is an ordinary paragraph and the number shown is the number written.

The citation each id stands for ("Dort 3/4.2", "BD 2.B.3") is derived from the
id in assets/gitbook/custom.js and assets/search_plus_index.json.

Usage:
  python3 script/section-anchors.py           # rewrite the _pages files
  python3 script/section-anchors.py --check   # verify, write nothing
"""
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
PAGES = REPO / "_pages"

# A generated anchor, recognised by its namespace so that nothing else is touched.
NAMESPACES = ("hc-q", "belgic-", "dort-", "fg-", "bd-", "dpw-", "nicene-")
ANCHOR = r'<span id="(?:%s)[^"]*"></span>' % "|".join(re.escape(n) for n in NAMESPACES)
ANCHOR_LINE = re.compile(r"^%s$" % ANCHOR)
ANCHOR_PREFIX = re.compile(r"^%s(?=\d+\. )" % ANCHOR)

ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


class AnchorError(Exception):
    pass


def roman_to_int(numeral):
    total = 0
    for i, letter in enumerate(numeral):
        value = ROMAN[letter]
        following = ROMAN[numeral[i + 1]] if i + 1 < len(numeral) else 0
        total += -value if value < following else value
    return total


def heading_level(line):
    match = re.match(r"^(#{1,6}) ", line)
    return len(match.group(1)) if match else 0


class Numbered:
    """Documents whose headings each carry a number: Heidelberg, Belgic."""

    def __init__(self, stem):
        self.stem = stem
        self.expected = 1

    def heading(self, line):
        match = re.match(r"^## (\d+)\. ", line)
        if not match:
            raise AnchorError("unexpected heading: %s" % line)
        number = int(match.group(1))
        if number != self.expected:
            raise AnchorError("expected %d, found heading %s" % (self.expected, line))
        self.expected += 1
        return self.stem + str(number)

    def paragraph(self, number, line):
        return None


class Dort:
    HEADS = {"First": "1", "Second": "2", "Third and Fourth": "3-4", "Fifth": "5"}

    def __init__(self):
        self.head = None
        self.in_rejection = False
        self.expected = 1

    def heading(self, line):
        match = re.match(r"^## The (First|Second|Third and Fourth|Fifth) Main Points? of Doctrine", line)
        if match:
            self.head = self.HEADS[match.group(1)]
            self.in_rejection = False
            self.expected = 1
            return "dort-" + self.head
        if line.startswith("## Rejection of the Errors"):
            self.in_rejection = True
            self.expected = 1
            return "dort-%s-rej" % self.require_head(line)
        if line.startswith("## Conclusion"):
            self.head = None
            return "dort-conclusion"
        match = re.match(r"^### Article (\d+):", line)
        if match and not self.in_rejection:
            return "dort-%s-%d" % (self.require_head(line), self.next_number(int(match.group(1)), line))
        match = re.match(r"^### Error ([IVXLC]+)\s*$", line)
        if match and self.in_rejection:
            number = self.next_number(roman_to_int(match.group(1)), line)
            return "dort-%s-rej-%d" % (self.require_head(line), number)
        raise AnchorError("unexpected heading: %s" % line)

    def require_head(self, line):
        if not self.head:
            raise AnchorError("heading outside a main point of doctrine: %s" % line)
        return self.head

    def next_number(self, number, line):
        if number != self.expected:
            raise AnchorError("expected %d, found heading %s" % (self.expected, line))
        self.expected += 1
        return number

    def paragraph(self, number, line):
        return None


class Nicene:
    def heading(self, line):
        match = re.match(r"^## .*\((\d{3}) AD\)\s*$", line)
        if not match:
            raise AnchorError("unexpected heading: %s" % line)
        return "nicene-" + match.group(1)

    def paragraph(self, number, line):
        return None


class ChurchOrder:
    """FG, BD and DPW: chapters, optional lettered sections, numbered paragraphs."""

    def __init__(self, stem):
        self.stem = stem
        self.chapter = None
        self.section = None
        self.expected = 1

    def unit(self):
        parts = [self.stem, self.chapter] + ([self.section] if self.section else [])
        return "-".join(parts)

    def heading(self, line):
        match = re.match(r"^## Chapter ([IVXLC]+)\s*:", line)
        if match:
            self.chapter, self.section, self.expected = str(roman_to_int(match.group(1))), None, 1
            return self.unit()
        if re.match(r"^## Preface\s*$", line):
            self.chapter, self.section, self.expected = "preface", None, 1
            return self.unit()
        match = re.match(r"^### ([A-Z])\. ", line)
        if match and self.chapter:
            self.section, self.expected = match.group(1).lower(), 1
            return self.unit()
        raise AnchorError("unexpected heading: %s" % line)

    def paragraph(self, number, line):
        if not self.chapter:
            raise AnchorError("numbered paragraph before any chapter: %s" % line[:60])
        if number != self.expected:
            raise AnchorError("%s: expected paragraph %d, found %s"
                              % (self.unit(), self.expected, line[:60]))
        self.expected += 1
        return "%s-%d" % (self.unit(), number)


DOCUMENTS = {
    "heidelberg.md": lambda: Numbered("hc-q"),
    "belgic.md": lambda: Numbered("belgic-"),
    "canons-of-dort.md": Dort,
    "nicene-creed.md": Nicene,
    "fg.md": lambda: ChurchOrder("fg"),
    "bd.md": lambda: ChurchOrder("bd"),
    "dpw.md": lambda: ChurchOrder("dpw"),
}


def split_front_matter(text):
    if not text.startswith("---\n"):
        raise AnchorError("no front matter")
    end = text.index("\n---\n", 4) + len("\n---\n")
    return text[:end], text[end:]


def anchored(name, text):
    """Return the file text with every anchor in place, and the ids written."""
    front, body = split_front_matter(text)
    walker = DOCUMENTS[name]()

    # Start from the text as it would be with no generated anchors, so a rerun
    # reproduces the file exactly and a renumbered paragraph gets a fresh id.
    # The blank line written before a heading's anchor stays: the rerun finds
    # it already there and does not add another.
    lines = []
    for line in body.split("\n"):
        if ANCHOR_LINE.match(line):
            continue
        lines.append(ANCHOR_PREFIX.sub("", line))

    out = []
    ids = []
    in_html = 0
    for line in lines:
        # Commentary and proof callouts are raw HTML blocks; nothing in them is
        # a heading or a numbered paragraph of the document itself.
        in_html += line.count("<details") - line.count("</details>")
        if in_html:
            out.append(line)
            continue
        if heading_level(line) >= 2:
            anchor = walker.heading(line)
            # Blank line first, or kramdown would fold the span into the
            # paragraph above instead of giving it its own empty <p>.
            if out and out[-1] != "":
                out.append("")
            out.append('<span id="%s"></span>' % anchor)
            ids.append(anchor)
            out.append(line)
            continue
        match = re.match(r"^(\d+)\. ", line)
        if match:
            anchor = walker.paragraph(int(match.group(1)), line)
            if anchor:
                out.append('<span id="%s"></span>%s' % (anchor, line))
                ids.append(anchor)
                continue
        out.append(line)

    existing = re.findall(r'\sid="([^"]+)"', "\n".join(lines))
    clashes = sorted({i for i in ids if ids.count(i) > 1} | (set(ids) & set(existing)))
    if clashes:
        raise AnchorError("duplicate ids: %s" % ", ".join(clashes))
    return front + "\n".join(out), ids


def main(argv):
    check = "--check" in argv
    stale = []
    total = 0
    for name in DOCUMENTS:
        path = PAGES / name
        text = path.read_text(encoding="utf-8")
        try:
            result, ids = anchored(name, text)
        except AnchorError as error:
            raise SystemExit("%s: %s" % (name, error))
        total += len(ids)
        if result != text:
            if check:
                stale.append(name)
            else:
                path.write_text(result, encoding="utf-8")
                print("wrote %s (%d anchors)" % (name, len(ids)))
    if stale:
        raise SystemExit(
            "section anchors out of date in %s — run script/section-anchors.py"
            % ", ".join(stale))
    if check:
        print("section anchors OK: %d anchors across %d documents" % (total, len(DOCUMENTS)))


if __name__ == "__main__":
    main(sys.argv[1:])
