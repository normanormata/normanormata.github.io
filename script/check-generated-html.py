#!/usr/bin/env python3
"""Check semantic and crawler-visible invariants in the generated site."""

from __future__ import annotations

from html.parser import HTMLParser
import pathlib
import re
import sys


class PageAudit(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.h1 = 0
        self.main = 0
        self.skip_links = 0
        self.edition_panels = 0
        self.buttons: list[dict[str, str]] = []
        self.button_text: list[list[str]] = []
        self._button_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        attributes = dict(attrs)
        if tag == "h1":
            self.h1 += 1
        elif tag == "main":
            self.main += 1
        elif tag == "a" and "skip-link" in attributes.get("class", "").split():
            self.skip_links += 1
        elif tag == "aside" and "edition-panel" in attributes.get("class", "").split():
            self.edition_panels += 1
        elif tag == "button":
            self.buttons.append(attributes)
            self.button_text.append([])
            self._button_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self._button_depth:
            self._button_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._button_depth and self.button_text:
            self.button_text[-1].append(data.strip())


def main() -> int:
    site = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
    expected = [
        site / "index.html",
        site / "search" / "index.html",
        *sorted((site / "pages").glob("*/index.html")),
        # The generated scripture index uses its own layout, so it needs the same
        # heading/landmark audit rather than inheriting the post layout's.
        site / "scripture" / "index.html",
        *sorted((site / "scripture").glob("*/index.html")),
    ]
    problems: list[str] = []
    audited = 0
    for path in expected:
        if not path.exists():
            problems.append(f"missing {path}")
            continue
        source = path.read_text(encoding="utf-8")
        audit = PageAudit()
        audit.feed(source)
        audited += 1
        relative = path.relative_to(site)
        if audit.h1 != 1:
            problems.append(f"{relative}: expected one h1, found {audit.h1}")
        if audit.main != 1:
            problems.append(f"{relative}: expected one main, found {audit.main}")
        if audit.skip_links != 1:
            problems.append(
                f"{relative}: expected one skip link, found {audit.skip_links}"
            )
        if "pages" in relative.parts and audit.edition_panels != 1:
            problems.append(
                f"{relative}: expected one edition panel, "
                f"found {audit.edition_panels}"
            )
        for number, (attrs, text_parts) in enumerate(
            zip(audit.buttons, audit.button_text), start=1
        ):
            name = attrs.get("aria-label") or attrs.get("title") or " ".join(
                part for part in text_parts if part
            )
            if not name.strip():
                problems.append(f"{relative}: button {number} has no accessible name")
        if 'class="v-const"' in source or 'class="v-modern"' in source:
            problems.append(f"{relative}: legacy paired variants are crawler-visible")
        if re.search(
            r"unexcusable;\s*without excuse|unto\s+to|hath\s+has|ofour|ourown",
            source,
            re.I,
        ):
            problems.append(f"{relative}: known merged-word corruption is visible")

    javascript = (site / "assets" / "gitbook" / "custom.js")
    if javascript.exists():
        js = javascript.read_text(encoding="utf-8")
        if "gitbook.toolbar.createButton" in js:
            problems.append("custom.js still creates empty href toolbar links")
        for label in (
            "Search",
            "Text: Constitutional",
            "Highlight changes",
            "Copy link",
        ):
            if label not in js:
                problems.append(f"custom.js is missing labeled control {label!r}")

    if problems:
        print(f"generated HTML check FAILED ({len(problems)} problems)\n")
        for problem in problems:
            print("  " + problem)
        return 1
    print(
        f"generated HTML OK: {audited} primary pages, one h1/main/skip link each, "
        "all buttons named"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
