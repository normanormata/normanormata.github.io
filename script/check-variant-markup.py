#!/usr/bin/env python3
"""Validate crawler text and both Westminster editions against OPC fixtures."""

from __future__ import annotations

import html
import json
import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "test" / "fixtures" / "westminster-text.json"
FILES = ("wcf", "wsc", "wlc")
VARIANT_RE = re.compile(
    r'<span class="text-variant" data-modern="([^"]*)">(.*?)</span>'
)
PROOF_RE = re.compile(r'<sup class="proof-marker">.*?</sup>')
TAG_RE = re.compile(r"<[^>]+>")
KNOWN_CORRUPTION = (
    "unto to",
    "hath has",
    "unexcusable;without excuse",
    "ofour",
    "ourown",
    "beadvanced",
    "the third epistle to timothy",
)


def normalize(value: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        html.unescape(value)
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"'),
    ).strip()


def edition_text(markup: str, modern: bool) -> str:
    def replace(match: re.Match) -> str:
        return html.unescape(match.group(1)) if modern else match.group(2)

    markup = VARIANT_RE.sub(replace, markup)
    markup = PROOF_RE.sub("", markup)
    return normalize(TAG_RE.sub("", markup))


def check_variant_shape(name: str, source: str) -> list[str]:
    problems: list[str] = []
    if 'class="v-const"' in source or 'class="v-modern"' in source:
        problems.append(f"{name}: legacy paired variant spans remain")
    for match in VARIANT_RE.finditer(source):
        if "<" in match.group(2):
            line = source.count("\n", 0, match.start()) + 1
            problems.append(f"{name}:{line}: markup nested inside a text variant")
    opens = source.count('<span class="text-variant"')
    matches = len(VARIANT_RE.findall(source))
    if opens != matches:
        problems.append(
            f"{name}: {opens - matches} malformed or unclosed text variants"
        )

    crawler = edition_text(source, modern=False).casefold()
    for phrase in KNOWN_CORRUPTION:
        if phrase in crawler:
            problems.append(f"{name}: crawler text contains {phrase!r}")
    return problems


def check_wcf(source: str, fixture: dict) -> list[str]:
    problems: list[str] = []
    pattern = re.compile(
        r'<p><span id="wcf-(\d+)-(\d+)"></span>\d+\.\s*(.*?)</p>', re.S
    )
    passages = {
        f"{match.group(1)}-{match.group(2)}": match.group(3)
        for match in pattern.finditer(source)
    }
    if len(passages) != 171:
        problems.append(f"wcf.md: found {len(passages)} sections; expected 171")
    for key, expected in fixture.items():
        if key == "1-2":
            continue
        if key not in passages:
            problems.append(f"wcf.md: missing section {key}")
            continue
        for modern, label in ((False, "constitutional"), (True, "mesv")):
            actual = edition_text(passages[key], modern)
            wanted = normalize(expected[label])
            if actual != wanted:
                problems.append(
                    f"wcf.md {key} {label}: text differs from OPC fixture\n"
                    f"    expected: {wanted[:180]}\n"
                    f"    actual:   {actual[:180]}"
                )

    section = source[
        source.index('<span id="wcf-1-2"') : source.index(
            '<span id="wcf-1-3"'
        )
    ]
    required_books = (
        "Matthew",
        "Mark",
        "Luke",
        "John",
        "Acts",
        "Romans",
        "I Corinthians",
        "II Corinthians",
        "Galatians",
        "Ephesians",
        "Philippians",
        "Colossians",
        "I Thessalonians",
        "II Thessalonians",
        "I Timothy",
        "II Timothy",
        "Titus",
        "Philemon",
        "Hebrews",
        "James",
        "I Peter",
        "II Peter",
        "I John",
        "II John",
        "III John",
        "Jude",
        "Revelation",
    )
    for book in required_books:
        if book not in section:
            problems.append(f"wcf.md 1-2: missing New Testament book {book}")
    if "third Epistle to Timothy" in section:
        problems.append("wcf.md 1-2: contains nonexistent third Timothy")
    return problems


def check_catechism(stem: str, source: str, fixture: dict) -> list[str]:
    problems: list[str] = []
    pattern = re.compile(
        rf'<span id="{stem}-q(\d+)"></span>\s*\n'
        r"### Question \1:\s*(.*?)[ \t]*\n"
        rf"Answer:\s*(.*?)(?=\n\n(?:<details class=\"scripture-proofs\"|"
        rf"<span id=\"{stem}-q\d+\"></span>|$))",
        re.S,
    )
    passages = {
        str(int(match.group(1))): {
            "question": match.group(2),
            "answer": match.group(3),
        }
        for match in pattern.finditer(source)
    }
    if len(passages) != len(fixture):
        problems.append(
            f"{stem}.md: found {len(passages)} questions; "
            f"expected {len(fixture)}"
        )
    for key, expected in fixture.items():
        if key not in passages:
            problems.append(f"{stem}.md: missing question {key}")
            continue
        for part in ("question", "answer"):
            for modern, label in ((False, "constitutional"), (True, "mesv")):
                actual = edition_text(passages[key][part], modern)
                wanted = normalize(expected[label][part])
                if actual != wanted:
                    problems.append(
                        f"{stem}.md {key} {part} {label}: differs from fixture\n"
                        f"    expected: {wanted[:180]}\n"
                        f"    actual:   {actual[:180]}"
                    )
    return problems


def main() -> int:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    problems: list[str] = []
    for stem in FILES:
        path = ROOT / "_pages" / f"{stem}.md"
        source = path.read_text(encoding="utf-8")
        problems.extend(check_variant_shape(path.name, source))
        if stem == "wcf":
            problems.extend(check_wcf(source, fixture[stem]))
        else:
            problems.extend(check_catechism(stem, source, fixture[stem]))

    if problems:
        print(f"Westminster integrity check FAILED ({len(problems)} problems)\n")
        for problem in problems[:40]:
            print("  " + problem)
        if len(problems) > 40:
            print(f"\n  …and {len(problems) - 40} more")
        return 1

    variants = sum(
        (ROOT / "_pages" / f"{stem}.md")
        .read_text(encoding="utf-8")
        .count('class="text-variant"')
        for stem in FILES
    )
    print(
        "Westminster integrity OK: 474 passages match OPC fixtures; "
        f"{variants} inert MESV variants validated"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
