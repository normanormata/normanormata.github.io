#!/usr/bin/env python3
"""Extract lettered scripture proofs from the OPC layout PDFs, via pdftohtml -xml.

These editions are laid out like a critical apparatus and the fonts separate the
three streams cleanly:

    size 15 (18 for Confession headings) — the confessional text
    size 11 — the superscript proof markers inside that text
    size 12 — the lettered proof apparatus below it

Working from font size rather than the flattened `pdftotext` output is what
makes marker extraction exact: once superscripts are flattened, "majestyg" is
indistinguishable from an ordinary word ending in g.
"""
import html
import re

SPAN = re.compile(
    r'<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="(\d+)">(.*?)</text>',
    re.S)
FONTSPEC = re.compile(r'<fontspec id="(\d+)" size="(\d+)"')

TEXT_SIZES = {15, 18}
MARKER_SIZE = 11
PROOF_SIZE = 12

BOOKS = r"""Gen|Ex|Lev|Num|Deut|Josh|Judg|Ruth|1 Sam|2 Sam|1 Kings|2 Kings|
1 Chron|2 Chron|Ezra|Neh|Esth|Est|Job|Ps|Prov|Eccl|Song|Isa|Jer|Lam|Ezek|Dan|Hos|
Joel|Amos|Obad|Jonah|Mic|Nah|Hab|Zeph|Hag|Zech|Mal|Matt|Mark|Luke|John|Acts|
Rom|1 Cor|2 Cor|Gal|Eph|Phil|Col|1 Thess|2 Thess|1 Tim|2 Tim|Titus|Philem|Heb|
James|1 Pet|2 Pet|1 John|2 John|3 John|Jude|Rev""".replace("\n", "")
# Books whose names are printed in full take no abbreviating period.
NO_PERIOD = {"John", "Acts", "Luke", "Mark", "Jude", "James", "Titus", "Ruth",
             "Ezra", "Job", "Joel", "Amos", "Jonah", "Song",
             "1 John", "2 John", "3 John", "1 Kings", "2 Kings"}
# "Ps. 86:9" / "Rom. 1:32-2:1" / "Matt. 4:4, 7, 10", and the chapter-only forms
# the layouts also use: "Ps. 145" for a whole psalm, "3 John 12" for a
# single-chapter book. The lookahead keeps the chapter-only branch from
# swallowing just the chapter of a normal chapter:verse citation.
VERSES = (r"\d+:\d+(?:[–—-]\d+(?::\d+)?)?(?:,\s*\d+(?:[–—-]\d+)?)*"
          r"|\d+(?!\s*:)")
REF = re.compile(rf"\b({BOOKS})\.?\s+({VERSES})")

CROSS_REF = re.compile(r"See chapter[^.]*\.", re.I)

RUNNING_HEAD = re.compile(
    r"THE SHORTER CATECHISM|THE LARGER CATECHISM|THE CONFESSION OF FAITH")


def is_ornamental(line):
    """True for the letter-spaced decorative lines on the closing pages.

    They extract as runs of isolated characters ("h s W s p t u") and would
    otherwise contribute phantom proof markers.
    """
    tokens = " ".join(t for _l, _s, t in line).split()
    if len(tokens) < 5:
        return False
    return all(len(t.strip(".,;:’")) <= 1 for t in tokens)


def read_spans(xml_path):
    """Spans in reading order: [(kind, text)] with kind in {text, marker, proof}."""
    xml = open(xml_path, encoding="utf-8", errors="replace").read()
    sizes = {m.group(1): int(m.group(2)) for m in FONTSPEC.finditer(xml)}
    out = []
    for page in xml.split("<page ")[1:]:
        spans = []
        for m in SPAN.finditer(page):
            top, left, _w, _h, font, raw = m.groups()
            txt = html.unescape(re.sub(r"<[^>]+>", "", raw))
            if not txt.strip():
                continue
            spans.append((int(top), int(left), sizes.get(font, 0), txt))

        # Group into visual lines: a superscript sits 2px above its baseline, so
        # sorting on raw `top` would place a marker before the word it follows.
        spans.sort(key=lambda s: (s[0], s[1]))
        lines, current, base = [], [], None
        for top, left, size, txt in spans:
            if base is None or abs(top - base) <= 5:
                base = top if base is None else base
                current.append((left, size, txt))
            else:
                lines.append(current)
                current, base = [(left, size, txt)], top
        if current:
            lines.append(current)

        for line in lines:
            line.sort(key=lambda s: s[0])
            if any(RUNNING_HEAD.search(t) for _, _, t in line):
                continue                      # drop the running head/foot
            if is_ornamental(line):
                continue
            for _left, size, txt in line:
                if size == MARKER_SIZE and len(txt.strip()) == 1 and txt.strip().isalpha():
                    out.append(("marker", txt.strip()))
                elif size in TEXT_SIZES:
                    out.append(("text", txt))
                elif size == PROOF_SIZE:
                    out.append(("proof", txt))
            # Line structure matters: proof blocks are identified by a lettered
            # label at the start of a line.
            out.append(("break", "\n"))
    return out


def streams(spans):
    """(confessional text with «x» markers inline, proof-apparatus text)."""
    text, proof = [], []
    for kind, txt in spans:
        if kind == "marker":
            text.append(f"«{txt}»")
        elif kind == "text":
            text.append(txt)
        elif kind == "proof":
            proof.append(txt)
        else:                       # line break — keep both streams aligned
            text.append("\n")
            proof.append("\n")
    squash = lambda parts: re.sub(r"[ \t]+", " ", "".join(parts))
    return squash(text), squash(proof)


def refs_in(block):
    out = []
    for m in REF.finditer(block):
        book, verses = m.group(1), m.group(2)
        verses = re.sub(r"[–—]", "-", re.sub(r"\s*,\s*", ", ", verses))
        ref = f"{book} {verses}" if book in NO_PERIOD else f"{book}. {verses}"
        if ref not in out:
            out.append(ref)
    return out


def proof_blocks(proof_text):
    """[(letter, [refs]), …] in document order.

    A few blocks cite another part of the Confession rather than scripture
    ("See chapter 5, section 4."); those are carried through verbatim.
    """
    proof_text = re.sub(r"(\w)-\n ?(\w)", r"\1\2", proof_text)   # de-hyphenate
    starts = list(re.finditer(r"^ ?([a-z])\.\s{1,3}(?=[1-3A-Z])", proof_text, re.M))
    blocks = []
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(proof_text)
        body = proof_text[m.end():end]
        refs = refs_in(body)
        if not refs:
            cross = CROSS_REF.search(body)
            if cross:
                refs = [cross.group(0)]
        blocks.append((m.group(1), refs))
    return blocks


def catechism_sections(text):
    """[(question number, [marker letters]), …]."""
    qs = list(re.finditer(r"Q\.\s*(\d+)\.", text))
    out = []
    for i, m in enumerate(qs):
        end = qs[i + 1].start() if i + 1 < len(qs) else len(text)
        out.append((int(m.group(1)), re.findall(r"«([a-z])»", text[m.end():end])))
    return out


ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


def _roman(r):
    n = 0
    for a, b in zip(r, r[1:] + " "):
        n += -ROMAN[a] if b in ROMAN and ROMAN[b] > ROMAN[a] else ROMAN[a]
    return n


def confession_sections(text):
    """[('chapter-section', [marker letters]), …].

    The Confession layout prints "Chapter 1" / "Of the Holy Scripture" as a
    heading, then numbered sections at the start of a line.
    """
    chapters = list(re.finditer(r"^\s*Chapter\s+(\d+)\s*$", text, re.M))
    out = []
    for i, m in enumerate(chapters):
        end = chapters[i + 1].start() if i + 1 < len(chapters) else len(text)
        body, ch = text[m.end():end], int(m.group(1))
        secs = list(re.finditer(r"^\s*(\d+)\.\s", body, re.M))
        for j, s in enumerate(secs):
            e = secs[j + 1].start() if j + 1 < len(secs) else len(body)
            out.append((f"{ch}-{s.group(1)}",
                        re.findall(r"«([a-z])»", body[s.end():e])))
    return out
