#!/usr/bin/env python3
"""Parse the lettered scripture proofs into structured citations.

The proof callouts already hold every citation the confessions make, but only in
the forward direction — "what does WCF 11.1 cite?" This module reads them back
out so the reverse question can be answered: "where is Romans 8:28 cited?"

Shared by script/build-scripture-index.py; kept separate so the parsing rules can
be exercised without generating pages.
"""
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent

# Documents that carry proof callouts, in the order references should be listed.
# `anchor` is how a callout id maps back to the linkable section on the page:
#   "span"    — the callout id is the section id with "-proofs" removed
#               (<span id="wcf-1-1"> sits in the paragraph above the callout)
#   "heading" — Heidelberg has no span anchors, so the link target is the
#               kramdown auto-id of the "## " heading the callout belongs to
DOCUMENTS = [
    {"slug": "wcf", "title": "Westminster Confession of Faith",
     "prefix": "WCF", "anchor": "span"},
    {"slug": "wsc", "title": "Westminster Shorter Catechism",
     "prefix": "WSC", "anchor": "span"},
    {"slug": "wlc", "title": "Westminster Larger Catechism",
     "prefix": "WLC", "anchor": "span"},
    {"slug": "heidelberg", "title": "Heidelberg Catechism",
     "prefix": "Heidelberg", "anchor": "heading"},
]

# Protestant canon in canonical order. `key` is the lookup form: lower-cased with
# the trailing period dropped and roman numerals folded to digits.
BOOKS = [
    ("Genesis", "OT", ["gen"]),
    ("Exodus", "OT", ["ex", "exod"]),
    ("Leviticus", "OT", ["lev"]),
    ("Numbers", "OT", ["num"]),
    ("Deuteronomy", "OT", ["deut"]),
    ("Joshua", "OT", ["josh"]),
    ("Judges", "OT", ["judg"]),
    ("Ruth", "OT", ["ruth"]),
    ("1 Samuel", "OT", ["1 sam"]),
    ("2 Samuel", "OT", ["2 sam"]),
    ("1 Kings", "OT", ["1 kings"]),
    ("2 Kings", "OT", ["2 kings"]),
    ("1 Chronicles", "OT", ["1 chron"]),
    ("2 Chronicles", "OT", ["2 chron"]),
    ("Ezra", "OT", ["ezra"]),
    ("Nehemiah", "OT", ["neh"]),
    ("Esther", "OT", ["est"]),
    ("Job", "OT", ["job"]),
    ("Psalms", "OT", ["ps", "psa"]),
    ("Proverbs", "OT", ["prov"]),
    ("Ecclesiastes", "OT", ["eccl", "eccles"]),
    ("Song of Solomon", "OT", ["song"]),
    # "Ez." appears once, at 36:25 — Ezra has ten chapters, so it is Ezekiel.
    ("Isaiah", "OT", ["isa", "is"]),
    ("Jeremiah", "OT", ["jer"]),
    ("Lamentations", "OT", ["lam"]),
    ("Ezekiel", "OT", ["ezek", "ez"]),
    ("Daniel", "OT", ["dan"]),
    ("Hosea", "OT", ["hos"]),
    ("Joel", "OT", ["joel"]),
    ("Amos", "OT", ["amos"]),
    ("Obadiah", "OT", ["obad"]),
    ("Jonah", "OT", ["jonah"]),
    ("Micah", "OT", ["mic"]),
    ("Nahum", "OT", ["nah"]),
    ("Habakkuk", "OT", ["hab"]),
    ("Zephaniah", "OT", ["zeph"]),
    ("Haggai", "OT", ["hag"]),
    ("Zechariah", "OT", ["zech", "zach"]),
    ("Malachi", "OT", ["mal"]),
    ("Matthew", "NT", ["matt", "mt"]),
    ("Mark", "NT", ["mark"]),
    ("Luke", "NT", ["luke"]),
    ("John", "NT", ["john", "joh"]),
    ("Acts", "NT", ["acts"]),
    ("Romans", "NT", ["rom"]),
    ("1 Corinthians", "NT", ["1 cor"]),
    ("2 Corinthians", "NT", ["2 cor"]),
    ("Galatians", "NT", ["gal"]),
    ("Ephesians", "NT", ["eph"]),
    ("Philippians", "NT", ["phil"]),
    ("Colossians", "NT", ["col"]),
    ("1 Thessalonians", "NT", ["1 thess"]),
    ("2 Thessalonians", "NT", ["2 thess"]),
    ("1 Timothy", "NT", ["1 tim"]),
    ("2 Timothy", "NT", ["2 tim"]),
    ("Titus", "NT", ["titus", "tit"]),
    ("Philemon", "NT", ["philem"]),
    ("Hebrews", "NT", ["heb"]),
    ("James", "NT", ["james"]),
    ("1 Peter", "NT", ["1 pet", "1 peter"]),
    ("2 Peter", "NT", ["2 pet", "2 peter"]),
    ("1 John", "NT", ["1 john"]),
    ("2 John", "NT", ["2 john"]),
    ("3 John", "NT", ["3 john"]),
    ("Jude", "NT", ["jude"]),
    ("Revelation", "NT", ["rev"]),
]

BOOK_ORDER = {name: i for i, (name, _, _) in enumerate(BOOKS)}
TESTAMENT = {name: t for name, t, _ in BOOKS}
ALIASES = {}
for _name, _t, _keys in BOOKS:
    for _key in _keys:
        ALIASES[_key] = _name

ROMAN = {"i": "1", "ii": "2", "iii": "3"}

# Books with no chapters: "Jude 6" is verse 6, not chapter 6.
SINGLE_CHAPTER = {"Obadiah", "Philemon", "2 John", "3 John", "Jude"}

# The proofs cite one thing that is not scripture — a cross-reference to another
# chapter of the Confession. Listed so that anything else unparsed is a defect.
KNOWN_NON_SCRIPTURE = {"See chapter 5, section 4."}

BLOCK = re.compile(
    r'<details class="scripture-proofs" id="([^"]+)">'
    r'.*?<div class="proofs-body">\s*(.*?)\s*</div>',
    re.S,
)
LETTER = re.compile(r"<strong>([^<]+)</strong>")
# A citation opens with a book name (letters, spaces, periods, and a leading
# numeral or roman numeral) or goes straight to a chapter, carrying the previous
# citation's book forward — "I Pet. 1:2; Rev. 1:5; 7:19" means Rev. 7:19.
CITATION = re.compile(r"^\s*(?P<book>[0-9IVi]*\s*[A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*)*)?\s*(?P<rest>[0-9].*)$")


def slugify(text):
    """kramdown's auto-generated heading id.

    Tags are dropped but their text is kept, which is why a heading carrying a
    proof marker ends up with the marker digit fused onto the last word.
    """
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[^a-zA-Z0-9 -]", "", text)
    return text.replace(" ", "-").lower()


def canonical_book(token):
    """Map a citation's book token to a canonical book name, or None."""
    key = token.strip().lower().rstrip(".")
    key = re.sub(r"\s+", " ", key)
    if key in ALIASES:
        return ALIASES[key]
    # Roman numerals ("I Cor."), including the one run together with its
    # abbreviation ("IPet."). Tried only after a direct lookup, so that "Isa."
    # stays Isaiah rather than splitting into "I" + "sa".
    match = re.match(r"^(i{1,3}|[1-3])\.?\s*([a-z].*)$", key)
    if match:
        head = ROMAN.get(match.group(1), match.group(1))
        return ALIASES.get(head + " " + match.group(2).rstrip("."))
    return None


def parse_locator(rest, chapter, single_chapter=False):
    """Expand the numeric part of a citation into (chapter, start, end, label).

    `chapter` carries in from the previous citation of the same book. `label` is
    the passage as it should read, which differs from (chapter, start, end) only
    for a range spanning chapters: "Rom. 1:32-2:1" is filed under both Romans 1
    and Romans 2, and under each it still reads "1:32-2:1". Returns the passages
    and the chapter to carry forward.
    """
    passages = []
    if single_chapter:
        chapter = 1
    for piece in rest.split(","):
        piece = piece.strip().rstrip(".").strip()
        if not piece:
            continue
        # Cross-chapter range: "1:32-2:1".
        match = re.fullmatch(r"(\d+):(\d+)\s*-\s*(\d+):(\d+)", piece)
        if match:
            start_ch, start_v, end_ch, end_v = (int(g) for g in match.groups())
            label = "%d:%d-%d:%d" % (start_ch, start_v, end_ch, end_v)
            passages.append((start_ch, start_v, None, label))
            for mid in range(start_ch + 1, end_ch):
                passages.append((mid, 1, None, label))
            passages.append((end_ch, 1, end_v, label))
            chapter = end_ch
            continue
        # "8:28" or "8:28-30".
        match = re.fullmatch(r"(\d+):(\d+)(?:\s*-\s*(\d+))?", piece)
        if match:
            chapter = int(match.group(1))
            start = int(match.group(2))
            end = int(match.group(3)) if match.group(3) else start
            passages.append((chapter, start, end, None))
            continue
        # A bare verse or verse range continuing the current chapter: "7, 10".
        match = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", piece)
        if match and chapter is not None:
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else start
            passages.append((chapter, start, end, None))
            continue
        # A whole chapter with no verses at all: "Ps. 23". The chapter is
        # deliberately not carried forward — the next bare number in "Gen. 1 and
        # 2" is a second whole chapter, not a verse of the first.
        if match:
            passages.append((int(match.group(1)), 0, None, None))
            continue
        raise ValueError(piece)
    return passages, chapter


# A comma is normally a verse separator, but a handful of proofs use one where a
# semicolon belongs: "Matt. 22:21, Rom. 13:1-8". Split only where a book name and
# a number follow, which a verse list can never look like.
NEW_CITATION = re.compile(r",\s*(?=(?:[1-3]|I{1,3})?\s*[A-Z][A-Za-z]*\.?\s+\d)")


def split_citations(chunk):
    """Break a letter's proof text into individual citations."""
    for part in chunk.split(";"):
        for piece in NEW_CITATION.split(part):
            # "Gen. 1 and 2" cites two whole chapters. Splitting produces "2" on
            # its own, which parses as a whole chapter because the book carries
            # forward while the chapter does not.
            for run in re.split(r"\s+and\s+", piece):
                yield run


def normalise_citation(raw):
    """Repair the punctuation variants the printed proofs use."""
    raw = raw.strip().strip(",").strip()
    # "Rom: 5:12" — a colon where the book's period belongs.
    raw = re.sub(r"(?<=[A-Za-z]):\s*(?=\d)", ". ", raw)
    # "Rom. 3: 20" — a space after the chapter's colon.
    raw = re.sub(r":\s+", ":", raw)
    return raw


def parse_proofs(body):
    """Yield (book, chapter, start, end) for every citation in a callout body.

    Also yields nothing for the one cross-reference to another chapter of the
    Confession rather than to scripture; callers get `unparsed` for those.
    """
    citations = []
    unparsed = []
    # Parenthetical secondary references ("Ps. 45:7 (Heb. 1:9)") are ordinary
    # citations; one of the three is missing its closing bracket in the source,
    # so drop the brackets rather than try to match them.
    body = body.replace("(", "; ").replace(")", " ")
    body = re.sub(r"</?p>", "", body)
    parts = LETTER.split(body)
    for i in range(1, len(parts), 2):
        letter = parts[i].strip().rstrip(".")
        chunk = parts[i + 1].strip().strip(",").strip()
        book = None
        chapter = None
        for raw in split_citations(chunk):
            raw = normalise_citation(raw)
            if not raw:
                continue
            if raw in KNOWN_NON_SCRIPTURE:
                continue
            match = CITATION.match(raw)
            if not match:
                unparsed.append(raw)
                continue
            token = match.group("book")
            if token:
                name = canonical_book(token)
                if name is None:
                    unparsed.append(raw)
                    continue
                book, chapter = name, None
            if book is None:
                unparsed.append(raw)
                continue
            try:
                passages, chapter = parse_locator(
                    match.group("rest"), chapter, book in SINGLE_CHAPTER)
            except ValueError:
                unparsed.append(raw)
                continue
            for chapter_no, start, end, label in passages:
                citations.append((book, chapter_no, start, end, label, letter))
    return citations, unparsed


def reference_for(section_id):
    """The citable short form for a section id: "WCF 1.1", "WLC 100"."""
    match = re.fullmatch(r"wcf-(\d+)-(\d+)", section_id)
    if match:
        return "WCF %s.%s" % match.groups()
    match = re.fullmatch(r"w(sc|lc)-q(\d+)", section_id)
    if match:
        return "W%sC %s" % (match.group(1).upper()[0], match.group(2))
    return None


def collect():
    """Read every proof callout in every document.

    Returns (citations, unparsed) where a citation is a dict carrying the passage
    and the section that cites it.
    """
    citations = []
    unparsed = []
    for document in DOCUMENTS:
        path = REPO / "_pages" / (document["slug"] + ".md")
        text = path.read_text(encoding="utf-8")

        # Heidelberg callouts link to their heading, so walk the file in order and
        # remember the heading each callout falls under.
        heading_for = {}
        current = None
        for line in text.splitlines():
            if line.startswith("## "):
                current = line[3:]
            match = re.search(r'<details class="scripture-proofs" id="([^"]+)"', line)
            if match:
                heading_for[match.group(1)] = current

        for callout_id, body in BLOCK.findall(text):
            if document["anchor"] == "span":
                section_id = callout_id[: -len("-proofs")]
                reference = reference_for(section_id)
            else:
                heading = heading_for.get(callout_id)
                section_id = slugify(heading) if heading else None
                number = re.match(r"\s*(\d+)", heading or "")
                reference = ("Heidelberg " + number.group(1)) if number else None
            if not section_id or not reference:
                unparsed.append("%s: no anchor for %s" % (document["slug"], callout_id))
                continue

            found, bad = parse_proofs(body)
            for entry in bad:
                unparsed.append("%s %s: %s" % (document["prefix"], reference, entry))
            for book, chapter, start, end, label, letter in found:
                citations.append({
                    "book": book,
                    "chapter": chapter,
                    "start": start,
                    "end": end,
                    "label": label or passage_label(chapter, start, end),
                    "document": document["prefix"],
                    "reference": reference,
                    "url": "/pages/%s/#%s" % (document["slug"], section_id),
                    "letter": letter,
                })
    return citations, unparsed


def passage_label(chapter, start, end):
    """Human-readable form of a passage within its book: "8:28-30"."""
    if start == 0:
        return str(chapter)
    if end is None or end == 0:
        return "%d:%d" % (chapter, start)
    if end == start:
        return "%d:%d" % (chapter, start)
    return "%d:%d-%d" % (chapter, start, end)
