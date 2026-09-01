#!/usr/bin/env python3
"""One-off corpus sweep: checks every baked exercisePrompt sentence in
lib/words.ts against the "beraten bug" failure class — a sentence whose
English structure only really fits a different German word sharing the same
English gloss as the actual target (see supabase/functions/audit-word-fit's
own header for the full story and the audit-word-fit Edge Function must be
deployed for this to work: `npx supabase functions deploy audit-word-fit
--no-verify-jwt`).

Usage:
    python3 scripts/audit-word-fit.py

Resumable: re-running only checks ids still missing from
scripts/.audit-word-fit-cache.json (gitignored) — safe to re-run after an
interruption or after adding new words to lib/words.ts.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.audit-word-fit-cache.json')
FLAGGED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.audit-word-fit-flagged.json')

SUPABASE_URL = 'https://whjiebzglefivvczvpfb.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_Ebu1ILGhZKQ6XMiNcHsuwA_ny_A7z5s'
FUNCTION_URL = f'{SUPABASE_URL}/functions/v1/audit-word-fit'

BATCH_SIZE = 20
MAX_WORKERS = 4

# Per-line field extraction (a single multi-field regex silently drops
# fields when they appear in a different order or are absent on some
# entries — learned the hard way earlier this session).
ID_RE = re.compile(r"id:\s*'(\w+)'")
DE_RE = re.compile(r"\bde:\s*'((?:[^'\\]|\\.)*)'")
EN_RE = re.compile(r"\ben:\s*'((?:[^'\\]|\\.)*)'")
LEVEL_RE = re.compile(r"\blevel:\s*'(\w+)'")
PROMPT_RE = re.compile(r'exercisePrompt:\s*"((?:[^"\\]|\\.)*)"')


def parse_words():
    words = []
    with open(WORDS_PATH, encoding='utf-8') as f:
        for line in f:
            if "id:" not in line or "de:" not in line:
                continue
            m_id, m_de, m_en, m_level, m_prompt = (
                ID_RE.search(line), DE_RE.search(line), EN_RE.search(line),
                LEVEL_RE.search(line), PROMPT_RE.search(line),
            )
            if not (m_id and m_de and m_en and m_level and m_prompt):
                continue
            words.append({
                'id': m_id.group(1), 'de': m_de.group(1), 'en': m_en.group(1),
                'level': m_level.group(1), 'prompt': m_prompt.group(1),
            })
    return words


def call_batch(batch):
    items = [{'id': w['id'], 'wordDe': w['de'], 'wordEn': w['en'], 'sentence': w['prompt']} for w in batch]
    body = json.dumps({'items': items}).encode()
    req = urllib.request.Request(
        FUNCTION_URL, data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
            'apikey': SUPABASE_ANON_KEY,
        },
    )
    retries = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                result = json.loads(resp.read())
            return result.get('results', {})
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and retries < 5:
                retries += 1
                time.sleep(min(2 ** retries, 30))
                continue
            print(f"batch failed ({[w['id'] for w in batch]}): HTTP {e.code} {e.read()}", file=sys.stderr)
            return {}
        except Exception as e:
            if retries < 3:
                retries += 1
                time.sleep(3)
                continue
            print(f"batch failed ({[w['id'] for w in batch]}): {e}", file=sys.stderr)
            return {}


def main():
    words = parse_words()
    print(f"{len(words)} words have a baked exercisePrompt", file=sys.stderr)

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)
    by_id = {w['id']: w for w in words}
    targets = [w for w in words if w['id'] not in results]
    print(f"{len(targets)} still need auditing (resuming {len(results)} already done)", file=sys.stderr)

    batches = [targets[i:i + BATCH_SIZE] for i in range(0, len(targets), BATCH_SIZE)]
    start = time.time()
    done_batches = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(call_batch, b): b for b in batches}
        for fut in as_completed(futures):
            batch_results = fut.result()
            for wid, r in batch_results.items():
                results[wid] = r
            done_batches += 1
            if done_batches % 10 == 0:
                print(f"{done_batches}/{len(batches)} batches done ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    flagged = {wid: r for wid, r in results.items() if r.get('fits') is False}
    with open(FLAGGED_PATH, 'w', encoding='utf-8') as f:
        json.dump(
            {wid: {**r, 'de': by_id[wid]['de'], 'en': by_id[wid]['en'],
                   'level': by_id[wid]['level'], 'sentence': by_id[wid]['prompt']}
             for wid, r in flagged.items()},
            f, ensure_ascii=False, indent=1,
        )
    missing = [w['id'] for w in words if w['id'] not in results]
    print(f"Audited {len(results)}/{len(words)} words. Flagged: {len(flagged)}. "
          f"Missing/failed: {len(missing)}.", file=sys.stderr)
    print(f"Flagged ids written to {FLAGGED_PATH}", file=sys.stderr)


if __name__ == '__main__':
    main()
