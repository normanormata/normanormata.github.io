#!/usr/bin/env python3
"""Rebuild Westminster source text and MESV variants from the OPC fixture.

The constitutional text remains normal HTML text. MESV alternatives live only
in data-modern attributes, so crawlers and no-JavaScript readers see exactly
one authoritative edition.
"""

from __future__ import annotations

import difflib
import html
import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "test" / "fixtures" / "westminster-text.json"
VARIANT_RE = re.compile(
    r'<span class="text-variant" data-modern="([^"]*)">(.*?)</span>'
)
PROOF_RE = re.compile(r'<sup class="proof-marker">.*?</sup>')
TAG_RE = re.compile(r"<[^>]+>")


def normalized_word(word: str) -> str:
    return (
        html.unescape(word)
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
    )


def visible_text(markup: str) -> str:
    markup = VARIANT_RE.sub(lambda match: match.group(2), markup)
    markup = PROOF_RE.sub("", markup)
    return html.unescape(TAG_RE.sub("", markup))


def source_words_and_markers(markup: str) -> tuple[list[str], dict[int, list[str]]]:
    """Return constitutional source words and proof markers after word indexes."""
    markup = VARIANT_RE.sub(lambda match: match.group(2), markup)
    words: list[str] = []
    markers: dict[int, list[str]] = {}
    cursor = 0
    for marker in PROOF_RE.finditer(markup):
        words.extend(html.unescape(TAG_RE.sub("", markup[cursor : marker.start()])).split())
        markers.setdefault(max(0, len(words) - 1), []).append(marker.group(0))
        cursor = marker.end()
    words.extend(html.unescape(TAG_RE.sub("", markup[cursor:])).split())
    return words, markers


def map_markers(markup: str, official_words: list[str]) -> dict[int, list[str]]:
    source_words, markers = source_words_and_markers(markup)
    if not markers:
        return {}
    matcher = difflib.SequenceMatcher(
        None,
        [normalized_word(word) for word in source_words],
        [normalized_word(word) for word in official_words],
        autojunk=False,
    )
    exact: dict[int, int] = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            exact[block.a + offset] = block.b + offset

    mapped: dict[int, list[str]] = {}
    exact_keys = sorted(exact)
    for source_index, values in markers.items():
        if source_index in exact:
            target = exact[source_index]
        else:
            before = [key for key in exact_keys if key < source_index]
            after = [key for key in exact_keys if key > source_index]
            if before:
                anchor = before[-1]
                target = min(len(official_words) - 1, exact[anchor] + source_index - anchor)
            elif after:
                anchor = after[0]
                target = max(0, exact[anchor] - (anchor - source_index))
            else:
                target = min(source_index, len(official_words) - 1)
        mapped.setdefault(target, []).extend(values)
    return mapped


def variant_markup(
    constitutional: str, mesv: str, previous_markup: str = ""
) -> str:
    left = constitutional.split()
    right = mesv.split()
    markers = map_markers(previous_markup, left)
    output: list[str] = []
    matcher = difflib.SequenceMatcher(
        None,
        [normalized_word(word) for word in left],
        [normalized_word(word) for word in right],
        autojunk=False,
    )
    for operation, a1, a2, b1, b2 in matcher.get_opcodes():
        if operation == "equal":
            for left_index in range(a1, a2):
                output.append(html.escape(left[left_index], quote=False))
                if left_index in markers:
                    output[-1] += "".join(markers[left_index])
            continue

        modern = " ".join(right[b1:b2])
        if operation == "insert":
            output.append(
                '<span class="text-variant" '
                f'data-modern="{html.escape(modern, quote=True)}"></span>'
            )
            continue

        for left_index in range(a1, a2):
            replacement = modern if left_index == a1 else ""
            rendered = (
                '<span class="text-variant" '
                f'data-modern="{html.escape(replacement, quote=True)}">'
                f"{html.escape(left[left_index], quote=False)}</span>"
            )
            if left_index in markers:
                rendered += "".join(markers[left_index])
            output.append(rendered)
    return " ".join(output)


def rebuild_wcf(text: str, fixture: dict) -> str:
    pattern = re.compile(
        r'<p><span id="wcf-(\d+)-(\d+)"></span>(\d+)\.\s*(.*?)</p>',
        re.S,
    )

    def replace(match: re.Match) -> str:
        key = f"{match.group(1)}-{match.group(2)}"
        # WCF 1.2 contains the canonical book tables between its opening and
        # closing sentences and is rebuilt separately below.
        if key == "1-2":
            return match.group(0)
        entry = fixture[key]
        body = variant_markup(
            entry["constitutional"], entry["mesv"], match.group(4)
        )
        return (
            f'<p><span id="wcf-{key}"></span>{match.group(3)}. {body}</p>'
        )

    rebuilt, count = pattern.subn(replace, text)
    if count != 171:
        raise SystemExit(f"wcf: found {count} sections; expected 171")

    entry = fixture["1-2"]
    old_open = re.search(
        r'<p><span id="wcf-1-2"></span>2\.\s*(.*?)</p>', rebuilt, re.S
    )
    if not old_open:
        raise SystemExit("wcf: could not find section 1.2")
    first_sentence = entry["constitutional"].split("Of the Old Testament:", 1)[0].strip()
    mesv_first = entry["mesv"].split("Of the Old Testament:", 1)[0].strip()
    opening = variant_markup(first_sentence, mesv_first, old_open.group(1))
    rebuilt = (
        rebuilt[: old_open.start()]
        + f'<p><span id="wcf-1-2"></span>2. {opening}</p>'
        + rebuilt[old_open.end() :]
    )
    return rebuilt


def rebuild_catechism(text: str, fixture: dict, stem: str) -> str:
    pattern = re.compile(
        rf'(<span id="{stem}-q(\d+)"></span>\s*\n)'
        r"### Question \2[:.]\s*(.*?)[ \t]*\n"
        rf"Answer:\s*(.*?)(?=\n\n(?:<details class=\"scripture-proofs\"|"
        rf"<span id=\"{stem}-q\d+\"></span>|$))",
        re.S,
    )

    def replace(match: re.Match) -> str:
        key = str(int(match.group(2)))
        entry = fixture[key]
        question = variant_markup(
            entry["constitutional"]["question"],
            entry["mesv"]["question"],
            match.group(3),
        )
        answer = variant_markup(
            entry["constitutional"]["answer"],
            entry["mesv"]["answer"],
            match.group(4),
        )
        return (
            f"{match.group(1)}### Question {key}: {question}\n"
            f"Answer: {answer}"
        )

    rebuilt, count = pattern.subn(replace, text)
    if count != len(fixture):
        raise SystemExit(
            f"{stem}: rebuilt {count} questions; expected {len(fixture)}"
        )
    return rebuilt


def main() -> int:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for stem in ("wcf", "wsc", "wlc"):
        path = ROOT / "_pages" / f"{stem}.md"
        text = path.read_text(encoding="utf-8")
        if stem == "wcf":
            rebuilt = rebuild_wcf(text, fixture[stem])
        else:
            rebuilt = rebuild_catechism(text, fixture[stem], stem)
        path.write_text(rebuilt, encoding="utf-8")
        print(f"Rebuilt {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
