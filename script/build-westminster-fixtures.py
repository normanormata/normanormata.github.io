#!/usr/bin/env python3
"""Extract authoritative Westminster text from the OPC comparison PDFs.

The PDFs in assets/ place the constitutional text in the left column and the
2025 Modern English Study Version (MESV) in the right. This script converts the
positioned PDF text to stable JSON fixtures used by the content checker.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET


ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FIXTURE = ROOT / "test" / "fixtures" / "westminster-text.json"

SOURCES = {
    "wcf": (
        "Two_column_comparison_of_the_constitutional_text_of_"
        "The_Confession_of_Faith_and_2025_MESV.pdf",
        171,
    ),
    "wsc": (
        "Two_column_comparison_of_the_constitutional_text_of_"
        "The_Shorter_Catechism_and_2025_MESV.pdf",
        107,
    ),
    "wlc": (
        "Two_column_comparison_of_the_constitutional_text_of_"
        "The_Larger_Catechism_and_2025_MESV.pdf",
        196,
    ),
}


def clean_extracted_text(value: str) -> str:
    """Repair deterministic artifacts from small caps and tight PDF kerning."""
    value = re.sub(r"\bL (thy|your) ORD\b", r"LORD \1", value)
    value = re.sub(r"(?<=[.!?;,])(?=[A-Za-z0-9])", " ", value)
    value = value.replace("Whatis ", "What is ")
    return re.sub(r"\s+", " ", value).strip()


def page_lines(page: ET.Element, side: int) -> list[str]:
    """Return visual lines from one column, excluding running headers."""
    spans: list[tuple[int, int, str]] = []
    # The comparison PDFs have a small gutter around x=450. Using the precise
    # page midpoint loses question-number spans that begin at x=458.
    for node in page.findall("text"):
        top = int(node.get("top", "0"))
        left = int(node.get("left", "0"))
        text = "".join(node.itertext()).replace("\xa0", " ")
        if top < 125 or not text.strip():
            continue
        if (left < 450) != (side == 0):
            continue
        spans.append((top, left, text))

    rows: list[list[object]] = []
    for top, left, text in sorted(spans):
        if not rows or top - int(rows[-1][0]) > 3:
            rows.append([top, [(left, text)]])
        else:
            rows[-1][1].append((left, text))  # type: ignore[union-attr]

    lines: list[str] = []
    for _, parts in rows:
        line = "".join(text for _, text in sorted(parts))  # type: ignore[arg-type]
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        if re.match(
            r"^(THE (CONFESSION|SHORTER|LARGER)|2025 MESV)", line, re.I
        ):
            continue
        lines.append(line)
    return lines


def parse_wcf(root: ET.Element) -> dict[str, dict[str, str]]:
    editions: list[dict[str, str]] = [{}, {}]
    cursors = [{"chapter": None, "key": None}, {"chapter": None, "key": None}]
    for page in root.findall("page"):
        for side in (0, 1):
            cursor = cursors[side]
            for line in page_lines(page, side):
                chapter = re.match(r"Chapter\s+(\d+)", line, re.I)
                if chapter:
                    cursor["chapter"] = int(chapter.group(1))
                    cursor["key"] = None
                    continue
                section = re.match(r"(\d+)\.\s+(.*)", line)
                if cursor["chapter"] and section:
                    key = f"{cursor['chapter']}-{int(section.group(1))}"
                    cursor["key"] = key
                    editions[side][key] = section.group(2)
                elif cursor["key"]:
                    editions[side][cursor["key"]] += " " + line

    return {
        key: {
            "constitutional": clean_extracted_text(editions[0][key]),
            "mesv": clean_extracted_text(editions[1][key]),
        }
        for key in editions[0]
    }


def parse_catechism(
    root: ET.Element, shorter: bool
) -> dict[str, dict[str, dict[str, str]]]:
    editions: list[dict[str, dict[str, str]]] = [{}, {}]
    cursors = [{"key": None, "phase": None}, {"key": None, "phase": None}]
    question_re = (
        re.compile(r"(\d+)\.\s*Q\.\s*(.*)")
        if shorter
        else re.compile(r"Q\.\s*(\d+)\.\s*(.*)")
    )

    for page in root.findall("page"):
        for side in (0, 1):
            cursor = cursors[side]
            for line in page_lines(page, side):
                question = question_re.match(line)
                if question:
                    key = str(int(question.group(1)))
                    cursor.update(key=key, phase="question")
                    editions[side][key] = {
                        "question": question.group(2),
                        "answer": "",
                    }
                    continue
                answer = re.match(r"A\.\s*(.*)", line)
                if answer and cursor["key"]:
                    cursor["phase"] = "answer"
                    editions[side][cursor["key"]]["answer"] = answer.group(1)
                    continue
                if cursor["key"] and cursor["phase"]:
                    editions[side][cursor["key"]][cursor["phase"]] += " " + line

    return {
        key: {
            "constitutional": {
                part: clean_extracted_text(editions[0][key][part])
                for part in ("question", "answer")
            },
            "mesv": {
                part: clean_extracted_text(editions[1][key][part])
                for part in ("question", "answer")
            },
        }
        for key in editions[0]
    }


def extract(stem: str, pdf: pathlib.Path) -> dict:
    converter = shutil.which("pdftohtml")
    if not converter:
        raise SystemExit("pdftohtml is required (install Poppler)")
    with tempfile.TemporaryDirectory(prefix=f"{stem}-fixture-") as temp_dir:
        output_base = pathlib.Path(temp_dir) / stem
        subprocess.run(
            [converter, "-xml", "-i", str(pdf), str(output_base)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        root = ET.parse(output_base.with_suffix(".xml")).getroot()
        if stem == "wcf":
            return parse_wcf(root)
        return parse_catechism(root, shorter=stem == "wsc")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail instead of writing when the committed fixture is stale",
    )
    args = parser.parse_args()

    fixture = {
        "_meta": {
            "source": "Orthodox Presbyterian Church",
            "edition": "Constitutional text and 2025 Modern English Study Version",
            "source_url": "https://opc.org/confessions.html",
        }
    }
    for stem, (filename, expected) in SOURCES.items():
        entries = extract(stem, ASSETS / filename)
        if len(entries) != expected:
            raise SystemExit(
                f"{stem}: extracted {len(entries)} entries; expected {expected}"
            )
        fixture[stem] = entries

    rendered = json.dumps(fixture, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not FIXTURE.exists() or FIXTURE.read_text(encoding="utf-8") != rendered:
            raise SystemExit(
                "Westminster fixture is stale; run "
                "script/build-westminster-fixtures.py"
            )
        print("Westminster fixture matches the authoritative OPC PDFs")
        return 0

    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(rendered, encoding="utf-8")
    print(
        "Wrote "
        f"{sum(len(fixture[key]) for key in SOURCES)} passages to {FIXTURE}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
