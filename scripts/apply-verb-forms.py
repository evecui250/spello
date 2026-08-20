#!/usr/bin/env python3
"""Bakes scripts/.verb-forms-cache.json (from generate-verb-forms.py) into
lib/words.ts as each verb entry's `thirdPerson`/`pastTense`/`perfectTense`
fields. Idempotent: skips any entry that already has a `perfectTense`
field. Also upgrades an entry that already has thirdPerson/pastTense from
an earlier run of this script (before perfectTense existed) by inserting
just the missing perfectTense field, rather than skipping it as "already
done" or duplicating the other two.
"""
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.verb-forms-cache.json')

ID_RE = re.compile(r"id:\s*'(\w+)'")
DE_RE = re.compile(r"de:\s*'(?:[^'\\]|\\.)*'")
PAST_TENSE_RE = re.compile(r"pastTense:\s*'(?:[^'\\]|\\.)*'")
HAS_THIRD_RE = re.compile(r"\bthirdPerson:\s*'")
HAS_PERFECT_RE = re.compile(r"\bperfectTense:\s*'")


def escape_single(s):
    return s.replace('\\', '\\\\').replace("'", "\\'")


def main():
    with open(CACHE_PATH, encoding='utf-8') as f:
        cache = json.load(f)

    with open(WORDS_PATH, encoding='utf-8') as f:
        lines = f.readlines()

    applied, upgraded, skipped_has_perfect, skipped_no_cache, skipped_not_verb = 0, 0, 0, 0, 0
    for i, line in enumerate(lines):
        if "type: 'verb'" not in line:
            continue
        m = ID_RE.search(line)
        if not m:
            continue
        wid = m.group(1)
        if HAS_PERFECT_RE.search(line):
            skipped_has_perfect += 1
            continue
        entry = cache.get(wid)
        if not entry or not entry.get('thirdPerson') or not entry.get('pastTense') or not entry.get('perfectTense'):
            skipped_no_cache += 1
            continue

        if HAS_THIRD_RE.search(line):
            # Already has thirdPerson/pastTense from an earlier run — just
            # insert the missing perfectTense right after pastTense.
            past_match = PAST_TENSE_RE.search(line)
            if not past_match:
                skipped_not_verb += 1
                continue
            field = f", perfectTense: '{escape_single(entry['perfectTense'])}'"
            line = line[:past_match.end()] + field + line[past_match.end():]
            lines[i] = line
            upgraded += 1
            continue

        de_match = DE_RE.search(line)
        if not de_match:
            skipped_not_verb += 1
            continue
        fields = (
            f", thirdPerson: '{escape_single(entry['thirdPerson'])}'"
            f", pastTense: '{escape_single(entry['pastTense'])}'"
            f", perfectTense: '{escape_single(entry['perfectTense'])}'"
        )
        line = line[:de_match.end()] + fields + line[de_match.end():]
        lines[i] = line
        applied += 1

    with open(WORDS_PATH, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    print(f"Applied (all 3 fields, new): {applied}", file=sys.stderr)
    print(f"Upgraded (added perfectTense only): {upgraded}", file=sys.stderr)
    print(f"Skipped (already had perfectTense): {skipped_has_perfect}", file=sys.stderr)
    print(f"Skipped (no cache entry): {skipped_no_cache}", file=sys.stderr)
    print(f"Skipped (no de/pastTense match found): {skipped_not_verb}", file=sys.stderr)


if __name__ == '__main__':
    main()
