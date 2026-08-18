#!/usr/bin/env python3
"""Companion sweep for supabase/functions/fix-exercise-prompt — checks
every baked lib/words.ts exercisePrompt against its level's known-
vocabulary constraint (see generate-exercise-prompts.py's own docstring
for that constraint) and, for genuine violations, replaces the sentence
with an AI-repaired one. Re-run this whenever the corpus grows enough
that it's worth re-auditing, or after generate-exercise-prompts.py bakes
a new batch of sentences.

Prerequisite: fix-exercise-prompt is deliberately left UNDEPLOYED between
uses (no auth/rate-limiting of its own, not meant to be a standing public
endpoint) — redeploy it first:
    npx supabase functions deploy fix-exercise-prompt --no-verify-jwt
and delete it again when done:
    npx supabase functions delete fix-exercise-prompt

Usage:
    python3 scripts/vocab-compliance-sweep.py            # full sweep
    python3 scripts/vocab-compliance-sweep.py 50          # first 50 only, for a spot-check

Resumable via a local JSON cache (.vocab-compliance-cache.json,
gitignored). If a run finishes with
errors (rate-limit 502s survived all retries), delete just those ids'
entries from the cache and re-run — MAX_WORKERS=1 below is deliberately
conservative for exactly this reason (this account's gpt-4o TPM limit is
low; 3 concurrent workers can still trip it on the heavier B1/B2
batches).

Once a run reports 0 remaining errors, apply its violations back into
lib/words.ts: for each id where the result is {"ok": false, ...}, replace
that word's exercisePrompt/exercisePromptZh with the returned sentence/
sentenceZh — but first check the fix still contains a DISTINCTIVE word
from the target's own `en` gloss (excluding common filler words like
"have"/"to"/"one's"), not just any word overlap; the server-side check in
fix-exercise-prompt already guards against dropping the target word
entirely, but is too loose for idiomatic multi-word targets whose gloss
includes a filler word that can coincidentally already appear in an
unrelated fixed sentence. Skip (leave the original untouched) anything
that fails that stricter check and fix it by hand instead — this
happened for exactly one word (verfügen/"to have at one's disposal") the
first time this ran (2026-08-18).
"""
import concurrent.futures
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

WORDS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lib', 'words.ts')
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.vocab-compliance-cache.json')
FN_URL = 'https://whjiebzglefivvczvpfb.supabase.co/functions/v1/fix-exercise-prompt'
APIKEY = 'sb_publishable_Ebu1ILGhZKQ6XMiNcHsuwA_ny_A7z5s'
BATCH_SIZE = 15
MAX_WORKERS = 1

WORD_RANGE = {
    'A1': (3, 6), 'A2': (4, 8), 'B1': (6, 12), 'B2': (8, 14),
}
PREREQUISITE_LEVELS = {
    'A1': [], 'A2': ['A1'], 'B1': ['A1', 'A2'], 'B2': ['A1', 'A2', 'B1'],
}

OBJ_RE = re.compile(r"\{[^{}]*\}")
ID_RE = re.compile(r"id:\s*'(\w+)'")
DE_RE = re.compile(r"de:\s*'((?:[^'\\]|\\.)*)'")
EN_RE = re.compile(r"en:\s*'((?:[^'\\]|\\.)*)'")
LEVEL_RE = re.compile(r"level:\s*'(\w+)'")
HF_RE = re.compile(r"highFrequency:\s*true")
EP_RE = re.compile(r'exercisePrompt:\s*"((?:[^"\\]|\\.)*)"')
EPZH_RE = re.compile(r'exercisePromptZh:\s*"((?:[^"\\]|\\.)*)"')


def parse_words():
    with open(WORDS_PATH, encoding='utf-8') as f:
        content = f.read()
    words = []
    for m in OBJ_RE.finditer(content):
        chunk = m.group(0)
        idm = ID_RE.search(chunk)
        if not idm:
            continue
        dem = DE_RE.search(chunk)
        enm = EN_RE.search(chunk)
        lvlm = LEVEL_RE.search(chunk)
        if not (dem and enm and lvlm):
            continue
        epm = EP_RE.search(chunk)
        epzhm = EPZH_RE.search(chunk)
        words.append({
            'id': idm.group(1), 'de': dem.group(1), 'en': enm.group(1),
            'level': lvlm.group(1), 'hf': bool(HF_RE.search(chunk)),
            'exercisePrompt': epm.group(1) if epm else None,
            'exercisePromptZh': epzhm.group(1) if epzhm else None,
        })
    return words


def unescape(s):
    return s.replace('\\"', '"').replace("\\'", "'") if s else s


def known_vocab_for(by_level, level):
    pool = []
    for l in PREREQUISITE_LEVELS.get(level, []):
        pool.extend(by_level.get(l, []))
    seen, result = set(), []
    for w in pool:
        key = w['en'].lower()
        if key not in seen:
            seen.add(key)
            result.append(w['en'])
    return result


def call_fn(payload, retries=6):
    req = urllib.request.Request(
        FN_URL, data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'apikey': APIKEY},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')
            if e.code in (429, 502, 503, 504) and attempt < retries - 1:
                time.sleep(min(3 * (attempt + 1), 25))
                continue
            raise RuntimeError(f'HTTP {e.code}: {body[:300]}')
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(min(3 * (attempt + 1), 25))
                continue
            raise


def chunk(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    words = parse_words()
    by_level = {}
    for w in words:
        by_level.setdefault(w['level'], []).append(w)
    vocab_cache = {lvl: known_vocab_for(by_level, lvl) for lvl in WORD_RANGE}

    targets = [w for w in words if w['exercisePrompt'] and not (w['level'] == 'A1' and w['hf'])]
    if limit:
        targets = targets[:limit]

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)
    todo = [w for w in targets if w['id'] not in results]
    print(f"{len(todo)} to check (resuming {len(results)} already done, {len(targets)} total targets)", file=sys.stderr)

    batches = []
    for lvl, ws in by_level.items():
        if lvl not in WORD_RANGE:
            continue
        lvl_todo = [w for w in todo if w['level'] == lvl]
        for b in chunk(lvl_todo, BATCH_SIZE):
            batches.append((lvl, b))
    print(f"{len(batches)} batches", file=sys.stderr)

    def work(lvl, batch):
        min_w, max_w = WORD_RANGE[lvl]
        payload = {
            'level': lvl,
            'knownVocab': vocab_cache.get(lvl, []),
            'minWords': min_w, 'maxWords': max_w,
            'items': [
                {'id': w['id'], 'targetEn': w['en'], 'targetDe': w['de'],
                 'sentence': unescape(w['exercisePrompt'])}
                for w in batch
            ],
        }
        try:
            res = call_fn(payload)
        except Exception as e:
            return {w['id']: {'error': str(e)} for w in batch}
        out = {}
        res_map = res.get('results', {})
        for w in batch:
            r = res_map.get(w['id'])
            out[w['id']] = r if r is not None else {'error': 'missing from batch response'}
        return out

    done_batches = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(work, lvl, b) for lvl, b in batches]
        for fut in concurrent.futures.as_completed(futures):
            out = fut.result()
            results.update(out)
            done_batches += 1
            print(f"batch {done_batches}/{len(batches)}", file=sys.stderr)
            with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    violations = {k: v for k, v in results.items() if isinstance(v, dict) and v.get('ok') is False}
    errors = {k: v for k, v in results.items() if isinstance(v, dict) and 'error' in v}
    print(f"\nTotal checked: {len(results)}")
    print(f"Violations found: {len(violations)}")
    print(f"Errors: {len(errors)}")
    if errors:
        print("Sample errors:", list(errors.items())[:5])


if __name__ == '__main__':
    main()
