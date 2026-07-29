#!/usr/bin/env python3
"""Build {section: {letter: [refs]}} for WCF/WSC/WLC from the OPC layout PDFs.

This is the provenance of every scripture reference in the Scripture Proofs
callouts: they were generated from assets/{CF,SC,LC}Layout.pdf, not transcribed
by hand. Re-run it to re-derive or audit them.

Markers (from the confessional text) and proof blocks (from the apparatus) are
two independent extractions of the same letter sequence, so they cross-check
each other. They agree exactly for the Shorter Catechism; the other two differ
by a couple of positions out of a thousand, so the two streams are aligned with
difflib rather than zipped, and anything that does not align cleanly is
reported instead of guessed at.
"""
import difflib
import json
import sys

import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from opc_layout import (read_spans, streams, proof_blocks,          # noqa: E402
                        catechism_sections, confession_sections)

# Where `pdftohtml -xml assets/<name>.pdf` output lives. Regenerate with:
#   for f in CFLayout SCLayout LCLayout; do
#     pdftohtml -xml -i assets/$f.pdf build/$f
#   done
SP = str(pathlib.Path(__file__).resolve().parent.parent / "build")

SOURCES = [
    ("wcf", "CFLayout", confession_sections, lambda k: k),
    ("wsc", "SCLayout", catechism_sections, lambda k: f"q{k}"),
    ("wlc", "LCLayout", catechism_sections, lambda k: f"q{k}"),
]


def build(stem, pdf, section_parser, keyfmt):
    text, proof = streams(read_spans(f"{SP}/{pdf}.xml"))
    sections = section_parser(text)
    blocks = proof_blocks(proof)

    flat = [(keyfmt(key), letter)
            for key, letters in sections for letter in letters]
    marker_seq = "".join(l for _, l in flat)
    proof_seq = "".join(l for l, _ in blocks)

    result, unassigned = {}, []
    sm = difflib.SequenceMatcher(None, marker_seq, proof_seq, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for off in range(i2 - i1):
                key = flat[i1 + off][0]
                letter, refs = blocks[j1 + off]
                result.setdefault(key, []).append((letter, refs))
        else:
            # Pair what we can positionally and take the letter from the
            # *text*, which is what the reader sees: one Larger Catechism block
            # is labelled "j" where the answer marks it "i" (the sequence skips
            # j), and relabelling to the block would leave a dangling marker.
            for off in range(max(i2 - i1, j2 - j1)):
                mi, bj = i1 + off, j1 + off
                if bj >= j2:
                    unassigned.append((flat[mi][0] if mi < i2 else None,
                                       "marker with no proof block"))
                    continue
                letter, refs = blocks[bj]
                if mi < i2:
                    key, marker_letter = flat[mi]
                    letter = marker_letter
                else:
                    key = flat[min(i1, len(flat) - 1)][0] if flat else None
                if key:
                    result.setdefault(key, []).append((letter, refs))
                unassigned.append((key, letter))

    return sections, blocks, result, unassigned, marker_seq, proof_seq


if __name__ == "__main__":
    out = {}
    for stem, pdf, parser, keyfmt in SOURCES:
        sections, blocks, result, unassigned, ms, ps = build(stem, pdf, parser, keyfmt)
        empty = [k for k, v in result.items() if not v]
        print(f"{stem}: {len(sections)} sections, {len(ms)} markers, "
              f"{len(blocks)} proof blocks, exact={ms == ps}")
        print(f"   sections with proofs: {len(result)}   "
              f"blocks needing fallback: {len(unassigned)}")
        if unassigned:
            print(f"   fallback: {unassigned[:6]}")
        norefs = [(k, l) for k, v in result.items() for l, r in v if not r]
        if norefs:
            print(f"   blocks with no parsed references: {len(norefs)} {norefs[:5]}")
        out[stem] = {k: {l: r for l, r in v} for k, v in result.items()}
    with open(f"{SP}/opc_proofs.json", "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"\nwrote {SP}/opc_proofs.json")
