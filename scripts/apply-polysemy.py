#!/usr/bin/env python3
"""Bakes scripts/.polysemy-cache.json (from generate-polysemy.py) into
lib/words.ts, replacing each qualifying entry's `en` (and `zh`, if
present) field with the fuller multi-sense version. Idempotent: skips any
entry whose `en` already contains "/", so it's safe to re-run.
"""
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.polysemy-cache.json')

ID_RE = re.compile(r"id:\s*'(\w+)'")
EN_RE = re.compile(r"en:\s*'((?:[^'\\]|\\.)*)'")
ZH_RE = re.compile(r"zh:\s*'((?:[^'\\]|\\.)*)'")


def escape_single(s):
    return s.replace('\\', '\\\\').replace("'", "\\'")


def main():
    with open(CACHE_PATH, encoding='utf-8') as f:
        cache = json.load(f)

    with open(WORDS_PATH, encoding='utf-8') as f:
        lines = f.readlines()

    applied, skipped_already_slash, skipped_no_result, skipped_no_en_match = 0, 0, 0, 0
    for i, line in enumerate(lines):
        m = ID_RE.search(line)
        if not m:
            continue
        wid = m.group(1)
        en_match = EN_RE.search(line)
        if not en_match:
            skipped_no_en_match += 1
            continue
        if '/' in en_match.group(1):
            skipped_already_slash += 1
            continue
        entry = cache.get(wid)
        if not entry or not entry.get('en'):
            skipped_no_result += 1
            continue

        new_en = f"en: '{escape_single(entry['en'])}'"
        line = line[:en_match.start()] + new_en + line[en_match.end():]

        if entry.get('zh'):
            zh_match = ZH_RE.search(line)
            if zh_match:
                new_zh = f"zh: '{escape_single(entry['zh'])}'"
                line = line[:zh_match.start()] + new_zh + line[zh_match.end():]

        lines[i] = line
        applied += 1

    with open(WORDS_PATH, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    print(f"Applied: {applied}", file=sys.stderr)
    print(f"Skipped (already has '/'): {skipped_already_slash}", file=sys.stderr)
    print(f"Skipped (no qualifying result): {skipped_no_result}", file=sys.stderr)
    print(f"Skipped (no en match found): {skipped_no_en_match}", file=sys.stderr)


if __name__ == '__main__':
    main()
