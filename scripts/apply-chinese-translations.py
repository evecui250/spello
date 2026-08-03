#!/usr/bin/env python3
"""Bakes scripts/.zh-translations-cache.json (from translate-to-chinese.py)
into lib/words.ts as each entry's `zh`/`exercisePromptZh` fields. Idempotent:
skips any entry that already has a `zh` field, so it's safe to re-run after
translating newly-added words.
"""
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.zh-translations-cache.json')

ID_RE = re.compile(r"id:\s*'(\w+)'")
EN_RE = re.compile(r"en:\s*'(?:[^'\\]|\\.)*'")
PROMPT_RE = re.compile(r'exercisePrompt:\s*"(?:[^"\\]|\\.)*"')
HAS_ZH_RE = re.compile(r"\bzh:\s*'")


def escape_single(s):
    return s.replace('\\', '\\\\').replace("'", "\\'")


def escape_double(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


def main():
    with open(CACHE_PATH, encoding='utf-8') as f:
        cache = json.load(f)

    with open(WORDS_PATH, encoding='utf-8') as f:
        lines = f.readlines()

    applied, skipped_has_zh, skipped_no_cache, skipped_no_en_match = 0, 0, 0, 0
    for i, line in enumerate(lines):
        m = ID_RE.search(line)
        if not m:
            continue
        wid = m.group(1)
        if HAS_ZH_RE.search(line):
            skipped_has_zh += 1
            continue
        entry = cache.get(wid)
        if not entry or not entry.get('zh'):
            skipped_no_cache += 1
            continue

        en_match = EN_RE.search(line)
        if not en_match:
            skipped_no_en_match += 1
            continue
        zh_field = f", zh: '{escape_single(entry['zh'])}'"
        line = line[:en_match.end()] + zh_field + line[en_match.end():]

        if entry.get('promptZh'):
            prompt_match = PROMPT_RE.search(line)
            if prompt_match:
                pz_field = f', exercisePromptZh: "{escape_double(entry["promptZh"])}"'
                line = line[:prompt_match.end()] + pz_field + line[prompt_match.end():]

        lines[i] = line
        applied += 1

    with open(WORDS_PATH, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    print(f"Applied: {applied}", file=sys.stderr)
    print(f"Skipped (already had zh): {skipped_has_zh}", file=sys.stderr)
    print(f"Skipped (no cache entry): {skipped_no_cache}", file=sys.stderr)
    print(f"Skipped (no en match found): {skipped_no_en_match}", file=sys.stderr)


if __name__ == '__main__':
    main()
