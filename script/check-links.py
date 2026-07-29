#!/usr/bin/env python3
"""Check internal links and fragments in the built site.

The Westminster Standards carry ~1,800 proof-marker anchors pointing at their
Scripture Proofs callouts, and the search index deep-links to every section, so
a broken id is easy to introduce and impossible to spot by eye.

Checks, over _site:
  * every internal href resolves to a file that exists;
  * every #fragment resolves to an id on the target page;
  * every URL in the search index resolves, including its fragment.

External links (http/https/mailto) are skipped: they fail for reasons unrelated
to the commit under test.

Usage: python3 script/check-links.py [site_dir]
"""
import collections
import json
import pathlib
import re
import sys
from urllib.parse import unquote, urldefrag

HREF = re.compile(rb'(?:href|src)="([^"]+)"')
ID = re.compile(rb'\sid="([^"]+)"')
NAME = re.compile(rb'<a[^>]+name="([^"]+)"')
EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#|data:)", re.I)
COMMENT = re.compile(rb"<!--.*?-->", re.S)


def markup(path):
    """Page bytes with HTML comments removed — commented-out tags are not links."""
    return COMMENT.sub(b"", path.read_bytes())


def collect_ids(path):
    raw = markup(path)
    ids = {m.group(1).decode("utf-8", "replace") for m in ID.finditer(raw)}
    ids |= {m.group(1).decode("utf-8", "replace") for m in NAME.finditer(raw)}
    return ids


def resolve(site, page, href):
    """Map an href on `page` to a path under `site`, or None if not a page ref."""
    href = unquote(href)
    if href.startswith("/"):
        target = site / href.lstrip("/")
    else:
        target = (page.parent / href).resolve()
    if target.is_dir():
        target = target / "index.html"
    elif not target.suffix:
        candidate = pathlib.Path(str(target) + "/index.html")
        if candidate.exists():
            target = candidate
    return target


def main():
    site = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    if not site.is_dir():
        sys.exit(f"no built site at {site} — run a build first")

    pages = sorted(site.rglob("*.html"))
    id_cache, problems = {}, []
    checked = fragments = 0

    def ids_for(path):
        if path not in id_cache:
            id_cache[path] = collect_ids(path) if path.exists() else None
        return id_cache[path]

    for page in pages:
        rel = page.relative_to(site)
        for m in HREF.finditer(markup(page)):
            href = m.group(1).decode("utf-8", "replace")
            if EXTERNAL.match(href) and not href.startswith("#"):
                continue

            base, frag = urldefrag(href)
            target = page if base in ("", ".") else resolve(site, page, base)
            checked += 1

            if not target.exists():
                problems.append(f"{rel}: broken link -> {href}")
                continue
            if not frag:
                continue

            fragments += 1
            ids = ids_for(target)
            if ids is not None and frag not in ids:
                problems.append(
                    f"{rel}: #{frag} not found in {target.relative_to(site)} (from {href})")

    # The search index deep-links into pages; verify those too.
    index_path = site / "assets" / "search_plus_index.json"
    index_entries = 0
    if index_path.exists():
        with index_path.open() as fh:
            entries = json.load(fh)
        index_entries = len(entries)
        for key, entry in entries.items():
            base, frag = urldefrag(entry["url"])
            target = resolve(site, site / "index.html", base)
            if not target.exists():
                problems.append(f"search index: broken url {entry['url']}")
                continue
            if frag:
                ids = ids_for(target)
                if ids is not None and frag not in ids:
                    problems.append(f"search index: #{frag} missing in {base}")

    print(f"{len(pages)} pages, {checked} internal links "
          f"({fragments} with fragments), {index_entries} index entries")

    if problems:
        by_kind = collections.Counter(
            "broken link" if "broken link" in p else "missing fragment" for p in problems)
        print(f"\nFAILED: {len(problems)} problems ({dict(by_kind)})\n")
        for p in problems[:40]:
            print("  " + p)
        if len(problems) > 40:
            print(f"  … and {len(problems) - 40} more")
        return 1

    print("all internal links and fragments resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
