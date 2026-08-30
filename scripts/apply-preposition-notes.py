#!/usr/bin/env python3
"""Bakes scripts/.preposition-notes-cache.json (from
generate-preposition-notes.py) into lib/words.ts as each qualifying
entry's `prepositionNote` field. Idempotent: skips any entry that already
has a `prepositionNote` field, so it's safe to re-run after generating
notes for newly-added words.
"""
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.preposition-notes-cache.json')

ID_RE = re.compile(r"id:\s*'(\w+)'")
EN_RE = re.compile(r"en:\s*'(?:[^'\\]|\\.)*'")
HAS_NOTE_RE = re.compile(r"\bprepositionNote:\s*'")


def escape_single(s):
    return s.replace('\\', '\\\\').replace("'", "\\'")


def main():
    with open(CACHE_PATH, encoding='utf-8') as f:
        cache = json.load(f)

    with open(WORDS_PATH, encoding='utf-8') as f:
        lines = f.readlines()

    applied, skipped_has_note, skipped_no_note, skipped_no_en_match = 0, 0, 0, 0
    for i, line in enumerate(lines):
        m = ID_RE.search(line)
        if not m:
            continue
        wid = m.group(1)
        if HAS_NOTE_RE.search(line):
            skipped_has_note += 1
            continue
        entry = cache.get(wid)
        if not entry or not entry.get('note'):
            skipped_no_note += 1
            continue

        en_match = EN_RE.search(line)
        if not en_match:
            skipped_no_en_match += 1
            continue
        field = f", prepositionNote: '{escape_single(entry['note'])}'"
        line = line[:en_match.end()] + field + line[en_match.end():]

        lines[i] = line
        applied += 1

    with open(WORDS_PATH, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    print(f"Applied: {applied}", file=sys.stderr)
    print(f"Skipped (already had prepositionNote): {skipped_has_note}", file=sys.stderr)
    print(f"Skipped (no note in cache): {skipped_no_note}", file=sys.stderr)
    print(f"Skipped (no en match found): {skipped_no_en_match}", file=sys.stderr)


if __name__ == '__main__':
    main()
