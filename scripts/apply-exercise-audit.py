#!/usr/bin/env python3
"""Bakes scripts/.exercise-audit-apply.json (from audit-exercise-prompts.py)
into lib/words.ts's `exercisePrompt`/`exercisePromptZh` fields. Only ever
touches those two fields on an already-approved (pass-2-revalidated,
high/medium-confidence) id — never any other field, changed or not, and
never anything still sitting in .exercise-audit-review.json.

Backs up lib/words.ts to lib/words.ts.bak-<UTC timestamp> before writing, on
top of git history, then prints an id-by-id old -> new report so the change
can be sanity-checked with `git diff lib/words.ts` afterward.

Usage:
    python3 scripts/apply-exercise-audit.py
"""
import datetime
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
APPLY_PATH = os.path.join(SCRIPT_DIR, '.exercise-audit-apply.json')

ID_RE = re.compile(r"id:\s*'(\w+)'")
PROMPT_RE = re.compile(r'exercisePrompt:\s*"((?:[^"\\]|\\.)*)"')
PROMPT_ZH_RE = re.compile(r'exercisePromptZh:\s*"((?:[^"\\]|\\.)*)"')


def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"')


def escape_double(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


def main():
    if not os.path.exists(APPLY_PATH):
        sys.exit(f'{APPLY_PATH} not found — run scripts/audit-exercise-prompts.py first.')
    with open(APPLY_PATH, encoding='utf-8') as f:
        apply_map = json.load(f)
    if not apply_map:
        print('Nothing to apply (empty apply file).', file=sys.stderr)
        return

    with open(WORDS_PATH, encoding='utf-8') as f:
        lines = f.readlines()

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_path = f'{WORDS_PATH}.bak-{timestamp}'
    with open(backup_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(f'Backed up lib/words.ts to {backup_path}', file=sys.stderr)

    changes = []
    remaining = set(apply_map.keys())
    for i, line in enumerate(lines):
        id_m = ID_RE.search(line)
        if not id_m or id_m.group(1) not in apply_map:
            continue
        wid = id_m.group(1)
        entry = apply_map[wid]

        prompt_m = PROMPT_RE.search(line)
        if not prompt_m:
            continue
        old_en = unescape(prompt_m.group(1))
        new_en = entry['englishSentence']
        line = line[:prompt_m.start(1)] + escape_double(new_en) + line[prompt_m.end(1):]

        prompt_zh_m = PROMPT_ZH_RE.search(line)
        old_zh = unescape(prompt_zh_m.group(1)) if prompt_zh_m else None
        new_zh = entry['chineseSentence']
        if prompt_zh_m:
            line = line[:prompt_zh_m.start(1)] + escape_double(new_zh) + line[prompt_zh_m.end(1):]
        else:
            reprompt_m = PROMPT_RE.search(line)
            field = f', exercisePromptZh: "{escape_double(new_zh)}"'
            line = line[:reprompt_m.end()] + field + line[reprompt_m.end():]

        lines[i] = line
        remaining.discard(wid)
        changes.append({
            'id': wid, 'oldEnglish': old_en, 'newEnglish': new_en,
            'oldChinese': old_zh, 'newChinese': new_zh,
        })

    with open(WORDS_PATH, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    for c in changes:
        print(f"\n[{c['id']}]", file=sys.stderr)
        print(f"  EN: {c['oldEnglish']!r} -> {c['newEnglish']!r}", file=sys.stderr)
        print(f"  ZH: {c['oldChinese']!r} -> {c['newChinese']!r}", file=sys.stderr)

    print(f'\nApplied: {len(changes)}', file=sys.stderr)
    if remaining:
        print(f'Not found in lib/words.ts (skipped): {len(remaining)} -> {sorted(remaining)}', file=sys.stderr)


if __name__ == '__main__':
    main()
